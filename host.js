/**
 * dsh-composer-predictions — Host half.
 *
 * P0/P1: on-demand next-message prediction for the active DSH session.
 * The client sends only a session id; this half reads the real session log,
 * builds a tightly trimmed transcript, and asks ctx.llm for one suggestion.
 *
 * No session events are written: the prediction call is an ephemeral one-shot,
 * not part of the conversation transcript.
 */
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'

const ROUTE = '/dsh-composer-predictions/predict'
const PLUGIN_ID = 'dsh-composer-predictions'
const PROMPT_VERSION = '4'

/**
 * The plugin Config. Only `enabled` is volatile: it is the one field the
 * General settings row edits and the Host settings form projects. The other
 * fields stay ordinary patch configuration.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  provider: z.string().default(''),
  model: z.string().default(''),
  /** Empty = inherit the session's reasoning effort. */
  reasoningEffort: z.string().default(''),
  /** clean = filtered transcript; cache/prefix = exact session prefix when it fits. */
  contextMode: z.union(['clean', 'cache', 'prefix']).default('clean'),
  maxContextMessages: z.number().min(2).max(40).default(12),
  maxMessageChars: z.number().min(200).max(20000).default(4000),
  /** Total text budget for the filtered transcript. */
  maxTotalChars: z.number().min(2000).max(200000).default(16000),
  /** Exact-prefix budget; above this the request falls back to clean. */
  maxPrefixChars: z.number().min(2000).max(200000).default(24000),
  maxSuggestionChars: z.number().min(80).max(1000).default(300),
  maxOutputTokens: z.number().min(32).max(4096).default(400),
  /** -1 = omit temperature and use the adapter default. */
  temperature: z.number().min(-1).max(2).default(-1),
  maxConcurrent: z.number().min(1).max(8).default(2),
  timeoutMs: z.number().min(1000).max(60000).default(8000),
  stubText: z.string().default(''),
  debug: z.boolean().default(false),
})

const DEFAULTS = {
  enabled: true,
  /** Empty = inherit the session's provider/model. */
  provider: '',
  model: '',
  /** Empty = inherit the session's reasoning effort. */
  reasoningEffort: '',
  /**
   * 'clean' = dedicated prediction system prompt + filtered transcript.
   * 'cache'/'prefix' = exact session messages as the provider saw them, with
   *                    only the prediction instruction appended, when the
   *                    prefix fits maxPrefixChars. This is true prefix-cache
   *                    material; oversized sessions fall back to clean.
   */
  contextMode: 'clean',
  maxContextMessages: 12,
  maxMessageChars: 4000,
  maxTotalChars: 16000,
  maxPrefixChars: 24000,
  maxSuggestionChars: 300,
  maxOutputTokens: 400,
  timeoutMs: 8000,
  temperature: -1,
  maxConcurrent: 2,
  /** Dev-only: return this text without calling a model. */
  stubText: '',
  /** Dev-only: log the raw model text when it does not parse. */
  debug: false,
}

const PREDICTION_SYSTEM = `You predict the user's next message in an ongoing conversation about any task.
The transcript ends with the assistant's latest message.

Rules:
- Write as the user, not as the assistant. Never answer for the assistant.
- Continue the task: name the next concrete action, question, answer, or decision.
  Prefer one short imperative sentence; two only when needed.
- Match the user's language and level of detail (any language, terse vs explanatory).
- If the assistant asked a question or offered options, answer it directly, choosing one.
- If the assistant finished a step, suggest the smallest useful next step relevant to this conversation.
- Do not restate or praise the assistant's output, do not ask "would you like",
  and avoid generic offers or filler.
- Use inline code for identifiers; no markdown fences or multiple alternatives.
- If there is no useful next move, return null.

Example:
Assistant: "Implemented add(a, b) with a docstring."
User next: "Now add a few tests for it, including negative numbers."

Return exactly one JSON object:
{"suggestion": "<message>" | null}`

const PREDICTION_INSTRUCTION = `Based on the conversation above, produce the user's next message.
Return only one JSON object and nothing else; do not explain your choice.
{"suggestion": "<message>" | null}
If there is no useful next message, use null.`

function optionsOf(config) {
  return { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
}

function predictionTimeoutMs(value) {
  return Math.max(1000, Math.min(60000, Number(value) || 8000))
}

/**
 * Latest turn that ended normally, or null when a turn is still open / absent.
 * A turn ending in error/abort/blocked is deliberately not predicted.
 */
function latestClosedTurn(session) {
  const events = session.snapshotEvents()
  let end = null
  // Walk backwards: the first boundary is either the newest turn/end or a
  // turn/start that is still open. This keeps long sessions cheap.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type === 'turn/start') return null
    if (event.type === 'turn/end') {
      end = event
      break
    }
  }
  if (end === null) return null
  const kind = end.data?.reason?.kind
  if (kind !== 'completed' && kind !== 'max-tokens') return null
  return { turn: end.data.turn, reason: kind }
}

function textOfMessage(message) {
  const parts = []
  for (const block of message.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

function trimText(text, max) {
  if (text.length <= max) return text
  // Keep the initial request and the final question/decision, inside the same
  // strict UTF-16 budget. Both cuts preserve whole grapheme clusters.
  const marker = '\n…[truncated]…\n'
  const room = Math.max(0, max - marker.length)
  const head = truncateGraphemes(text, Math.floor(room * 0.25))
  let tail = ''
  const parts = splitGraphemes(text)
  let size = 0
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (size + parts[i].length > room - head.length) break
    size += parts[i].length
    tail = parts[i] + tail
  }
  return head + marker + tail
}

/**
 * Total text characters over every message, used to decide whether an exact
 * prefix still fits the configured budget. This is an approximation: tool-call
 * arguments and other non-text blocks are not counted.
 */
function totalTextChars(messages) {
  let total = 0
  for (const message of messages) {
    for (const block of message.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') total += block.text.length
    }
  }
  return total
}

/**
 * Text-only conversation, newest last. Tool results and injected context are
 * skipped here. The total returned text never exceeds options.maxTotalChars:
 * the oldest messages are dropped first, and the newest message is trimmed as
 * a last resort.
 */
function buildConversation(messages, options) {
  const keepSystem = options.contextMode === 'cache' || options.contextMode === 'prefix'
  let system = null
  if (keepSystem) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'system' && textOfMessage(messages[i]) !== '') {
        system = messages[i]
        break
      }
    }
  }
  const picked = []
  const budget = Math.max(2000, Number(options.maxTotalChars) || 16000)
  let chars = 0
  // Work only on the newest eligible suffix. Once an older message would not
  // fit, the old drop-oldest policy would discard it and everything before it.
  for (let i = messages.length - 1; i >= 0 && picked.length < options.maxContextMessages && chars < budget; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user' && message.role !== 'assistant') continue
    // Only a real human prompt is a useful "next message" anchor.
    if (message.role === 'user' && message.source?.kind !== 'user') continue
    let text = trimText(textOfMessage(message), options.maxMessageChars)
    if (text === '') continue
    if (picked.length > 0 && chars + text.length > budget) break
    if (text.length > budget) text = trimText(text, budget)
    picked.push({ role: message.role, text })
    chars += text.length
  }
  return { system, conversation: picked.reverse(), chars }
}

function textBlock(text) {
  return { type: 'text', text }
}

function messageOf(role, text, source) {
  return {
    id: `pred-${randomUUID()}`,
    role,
    content: [textBlock(text)],
    source,
  }
}

function parseSuggestion(raw) {
  if (typeof raw !== 'string') return null
  let cleaned = raw.trim()
  if (cleaned === '') return null
  cleaned = cleaned.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '').trim()

  let value
  try {
    value = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match === null) return parsePlainSuggestion(cleaned)
    try {
      value = JSON.parse(match[0])
    } catch {
      return null
    }
  }

  const suggestion = value?.suggestion
  if (typeof suggestion !== 'string') return null
  const text = suggestion.trim()
  if (text.length < 1 || text.length > 2000) return null
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null
  return text
}

/**
 * Models occasionally ignore the JSON wrapper and return the sentence
 * directly. Accept a short single-message answer, but reject analysis,
 * fences, malformed JSON and refusal text.
 */
function parsePlainSuggestion(raw) {
  let text = raw.trim()
  if (text === '' || text.length > 500) return null
  if (text.startsWith('{') || text.startsWith('[')) return null
  if (text.includes('```') || text.includes('"suggestion"')) return null
  if ((text.match(/\n/g) || []).length > 2) return null
  text = text.replace(/^(?:User|Assistant|Next message|Suggestion)\s*[:：]\s*/i, '').trim()
  if (/^(?:The user|The assistant|We need to|I cannot|I'm sorry|As an AI)\b/i.test(text)) return null
  // A plain answer must look like a message, not a parser-test string or a
  // fragment: require CJK, terminal punctuation, or an action opener.
  const hasCjk = /[\u3400-\u9fff]/.test(text)
  const endsSentence = /[.!?。！？…]$/.test(text)
  const actionStart = /^(?:Now|Add|Create|Write|Run|Use|Make|Fix|Update|Remove|Check|Test|Refactor|Implement|Please|Can you|Could you|Let's)\b/i.test(text)
  if (!hasCjk && !endsSentence && !actionStart) return null
  text = text.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim()
  if (text.length < 1) return null
  return text
}

/**
 * Keep the ghost to a predictable size. The Host clamps model output before
 * it reaches the client, so the composer never receives an unbounded string.
 */
function clampSuggestion(text, max) {
  if (typeof text !== 'string') return null
  const limit = Math.max(80, Math.min(1000, Number(max) || 300))
  if (text.length <= limit) return text
  const cut = truncateGraphemes(text, limit)
  const boundary = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('。'),
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('; '),
    cut.lastIndexOf('；'),
  )
  const kept = boundary > limit * 0.5 ? truncateGraphemes(cut, boundary + 1) : cut
  return kept.trim() + '…'
}

// Keep the existing UTF-16 budget while cutting only at grapheme boundaries.
function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
  }
  // Older engines: preserve combining marks, emoji modifiers, ZWJ sequences
  // and regional-indicator pairs instead of falling back to UTF-16 slicing.
  const result = []
  let mark
  try { mark = new RegExp('\\p{Mark}', 'u') } catch { mark = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/ }
  let regionalCount = 0
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0)
    const regional = code >= 0x1f1e6 && code <= 0x1f1ff
    const previous = result[result.length - 1]
    const joins = previous !== undefined && (mark.test(char)
      || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0020 && code <= 0xe007f)
      || (code >= 0xe0100 && code <= 0xe01ef) || (code >= 0x1f3fb && code <= 0x1f3ff)
      || char === '\u200d' || previous.endsWith('\u200d')
      || (char === '\n' && previous.endsWith('\r')) || (regional && regionalCount % 2 === 1))
    if (joins) result[result.length - 1] += char
    else result.push(char)
    regionalCount = regional ? regionalCount + 1 : 0
  }
  return result
}

function truncateGraphemes(text, limit) {
  if (text.length <= limit) return text
  let end = 0
  for (const part of splitGraphemes(text)) {
    if (end + part.length > limit) break
    end += part.length
  }
  return text.slice(0, end)
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

/**
 * Resolve the provider/model/effort a prediction request will use. The cache
 * key needs these before generation, and generate must use the same values so
 * a settings change cannot be served from a stale cache entry.
 */
function resolveCall(session, options) {
  const header = session.requestHeader()
  if (header === undefined) return { skipped: 'no-request-header' }

  const provider = options.provider || header.config.provider
  const model = options.model || header.config.model
  if (!provider || !model) return { skipped: 'no-model' }

  return {
    header,
    provider,
    model,
    // Effort ids belong to an exact model; never carry them across routes.
    reasoningEffort: options.reasoningEffort || ((provider === header.config.provider && model === header.config.model)
      ? header.config.reasoningEffort : undefined),
    explicitReasoning: Boolean(options.reasoningEffort),
  }
}

async function generate(ctx, session, turn, options, signal, call) {
  if (call === undefined) call = resolveCall(session, options)
  if (call.skipped) return { skipped: call.skipped }

  const { provider, model, reasoningEffort } = call
  const messages = session.deriveMessages()
  const instruction = messageOf('user', PREDICTION_INSTRUCTION, { kind: 'user' })

  const wantsPrefix = options.contextMode === 'cache' || options.contextMode === 'prefix'
  const prefixBudget = Math.max(2000, Number(options.maxPrefixChars) || 24000)
  let outbound = []
  let systemOption
  let cacheable = false
  let contextChars = 0

  const sameModel = provider === call.header?.config.provider && model === call.header?.config.model
  // Clean requests never traverse old content for prefix-only eligibility.
  const textOnly = wantsPrefix && sameModel && messages.every(message => (message.content ?? []).every(block => block?.type === 'text'))
  const exactChars = textOnly ? totalTextChars(messages) : 0
  if (textOnly && exactChars <= prefixBudget) {
    // True prefix cache: the exact model-visible messages, in order, with only
    // the prediction instruction appended. Do not filter, rebuild or truncate
    // them; any rewrite breaks the provider's prefix match.
    outbound = [...messages, instruction]
    cacheable = true
    contextChars = exactChars
  } else {
    // Once exact-prefix reuse is impossible, use the bounded clean transcript.
    // Keeping the original system here bypassed maxTotalChars entirely.
    const { system, conversation, chars } = buildConversation(messages, { ...options, contextMode: 'clean' })
    if (system !== null) {
      outbound.push({
        ...system,
        content: [textBlock(textOfMessage(system))],
      })
    }
    for (const message of conversation) {
      outbound.push(messageOf(message.role, message.text, {
        kind: message.role === 'assistant' ? 'model' : 'user',
        ...(message.role === 'assistant' ? { provider, model } : {}),
      }))
    }
    outbound.push(instruction)
    contextChars = chars + (system === null ? 0 : textOfMessage(system).length)
    systemOption = PREDICTION_SYSTEM
  }

  const request = {
    provider,
    model,
    reasoningEffort,
    messages: outbound,
    system: systemOption,
    maxTokens: Math.max(32, Math.min(4096, Number(options.maxOutputTokens) || 400)),
    ...(Number.isFinite(options.temperature) && options.temperature >= 0 ? { temperature: options.temperature } : {}),
    signal,
    sessionId: session.id,
  }

  let text = ''
  let usage = null
  let finish = null
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  const offTurn = ctx.on('session/event', (eventSession, event) => {
    if (eventSession.id === session.id && event.type === 'turn/start') controller.abort()
  })

  try {
    let stream = ctx.llm.stream.bind(ctx.llm)
    // New hosts bind metadata and dispatch to the same adapter generation.
    // Older hosts retain their public stream-only API; no private API import.
    if (typeof ctx.llm.prepareCall === 'function') {
      const prepared = await ctx.llm.prepareCall({ provider, model, reasoningEffort, maxTokens: request.maxTokens }, controller.signal,
        (controls, metadata) => {
          const configured = { ...controls }
          const efforts = metadata.reasoning?.efforts ?? []
          if (!call.explicitReasoning && !efforts.some(effort => effort.id === configured.reasoningEffort)) {
            delete configured.reasoningEffort
          }
          return configured
        })
      if (controller.signal.aborted) return { skipped: 'aborted' }
      if (prepared?.config === undefined || typeof prepared.stream !== 'function') return { skipped: 'invalid-config' }
      Object.assign(request, prepared.config)
      stream = prepared.stream.bind(prepared)
    }
    for await (const chunk of stream({ ...request, signal: controller.signal })) {
      if (controller.signal.aborted) break
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') finish = chunk.reason
    }
  } finally {
    offTurn?.()
    signal?.removeEventListener?.('abort', onAbort)
  }

  if (controller.signal.aborted) return { skipped: 'aborted' }
  if (finish === null) return { skipped: 'no-finish' }
  if (finish.kind !== 'stop') return finish.failure ? failureResult(finish.failure) : { skipped: 'finish-' + finish.kind }
  const suggestion = clampSuggestion(parseSuggestion(text), options.maxSuggestionChars)
  if (suggestion === null) {
    if (options.debug) {
      ctx.logger?.info?.('composer-predictions: abstained raw=' + JSON.stringify(text.slice(0, 1200)))
    }
    return { skipped: 'abstained', raw: options.debug ? text.slice(0, 1200) : undefined }
  }

  return {
    text: suggestion,
    turnId: turn.turn,
    model,
    provider,
    promptVersion: PROMPT_VERSION,
    contextMode: options.contextMode,
    cacheable,
    contextChars,
    usage,
  }
}

// Only a small, provider-neutral diagnostic crosses the HTTP/log boundary.
// Never return provider messages, URLs, credentials or echoed conversation text.
function failureResult(error) {
  const failure = error?.failure ?? error
  const code = typeof failure?.code === 'string' ? failure.code.toUpperCase() : ''
  const status = Number(failure?.status)
  let reason = 'error'
  if (['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(code) || status === 401 || status === 403) reason = 'auth'
  else if (code === 'RATE_LIMIT' || status === 429) reason = 'rate-limit'
  else if (['QUOTA', 'ACCOUNT_QUOTA'].includes(code)) reason = 'quota'
  else if (code === 'CONTEXT_WINDOW_EXCEEDED') reason = 'context-window'
  else if (['INVALID_CALL_CONFIG', 'INVALID_MODEL_INFO', 'INVALID_REASONING_EFFORT'].includes(code)) reason = 'invalid-config'
  else if (code === 'NO_ADAPTER' || status >= 500) reason = 'unavailable'
  return { skipped: reason }
}

function cacheGet(cache, key) {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  if (Date.now() - hit.at > 10 * 60 * 1000) {
    cache.delete(key)
    return undefined
  }
  // LRU touch: Map iteration order is insertion order.
  cache.delete(key)
  cache.set(key, hit)
  return hit.value
}

function cacheSet(cache, key, value) {
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 100) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/**
 * Resolve a live session, or rebuild a detached Session from the cold
 * persistence/query corpus. Cold sessions are observed without making them
 * live and without writing to their logs. sessionQuery is optional: a
 * deployment without it keeps the old live-only behavior.
 */
async function resolveSession(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId)
  if (live !== undefined) return live

  const query = ctx.get?.('sessionQuery')
  if (query === undefined || query === null || typeof query.observeSession !== 'function') {
    return undefined
  }

  let observation = null
  try {
    observation = await query.observeSession(sessionId, { projectionMode: 'none' })
    const prepared = ctx.sessions.prepare(sessionId, {
      seed: [...observation.events],
      meta: observation.header,
      inheritedEventCount: observation.inheritedEventCount,
      eventState: 'detached',
    })
    return prepared
  } catch (error) {
    ctx.logger?.warn?.('composer-predictions: cold session unavailable')
    return undefined
  } finally {
    try { observation?.[Symbol.dispose]?.() } catch {}
  }
}

async function predict(ctx, sessionId, options, cache, inflight, parentSignal, controllers, force = false) {
  const stubText = typeof options.stubText === 'string' ? options.stubText.trim() : ''
  if (stubText !== '') {
    return { text: clampSuggestion(stubText, options.maxSuggestionChars), turnId: null, stub: true }
  }

  const session = await resolveSession(ctx, sessionId)
  if (session === undefined) return { skipped: 'no-session' }

  const turn = latestClosedTurn(session)
  if (turn === null) return { skipped: 'no-turn' }

  // Resolve the exact call FIRST: the cache key must describe the request that
  // would actually run, not just the patch overrides.
  const call = resolveCall(session, options)
  if (call.skipped) return { skipped: call.skipped }

  // Keep the session id as a string prefix: the turn-start invalidation
  // deletes cache entries by `key.startsWith(session.id + ':')`.
  const key = sessionId + ':' + JSON.stringify({
    promptVersion: PROMPT_VERSION,
    turn: turn.turn,
    contextMode: options.contextMode,
    maxContextMessages: options.maxContextMessages,
    maxMessageChars: options.maxMessageChars,
    maxTotalChars: options.maxTotalChars,
    maxPrefixChars: options.maxPrefixChars,
    maxSuggestionChars: options.maxSuggestionChars,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    provider: call.provider,
    model: call.model,
    reasoningEffort: call.reasoningEffort ?? '',
  })
  if (!force) {
    const cached = cacheGet(cache, key)
    if (cached !== undefined) return cached
  }
  // A regenerate is a second model call even while the normal one is running;
  // it gets its own inflight slot but still refreshes the shared cache entry.
  const inflightKey = force ? key + ':regen' : key
  const running = inflight.get(inflightKey)
  if (running !== undefined && !running.controller.signal.aborted) {
    return subscribePrediction(running, parentSignal)
  }
  if (parentSignal?.aborted) return { skipped: 'aborted' }
  if ((controllers?.size ?? 0) >= Math.max(1, Math.min(8, Number(options.maxConcurrent) || 2))) return { skipped: 'busy' }

  // Only the most recently started generation may refresh this cache key.
  // Older callers still receive their own result; completion order is irrelevant.
  for (const entry of inflight.values()) {
    if (entry.key === key) entry.superseded = true
  }
  const controller = new AbortController()
  const entry = { key, controller, subscribers: 0, settled: false, superseded: false, promise: null }
  controllers?.add(controller)
  inflight.set(inflightKey, entry)
  let timedOut = false
  const timeout = setTimeout(
    () => { timedOut = true; controller.abort() },
    predictionTimeoutMs(options.timeoutMs),
  )
  entry.promise = (async () => {
    try {
      const result = await generate(ctx, session, turn, options, controller.signal, call)
      if (!controller.signal.aborted && !entry.superseded
        && (!result.skipped || result.skipped === 'abstained')) cacheSet(cache, key, result)
      return controller.signal.aborted ? { skipped: timedOut ? 'timeout' : 'aborted' } : result
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return { skipped: timedOut ? 'timeout' : 'aborted' }
      const result = failureResult(error)
      ctx.logger?.warn?.('composer-predictions: prediction failed (' + result.skipped + ')')
      return result
    } finally {
      entry.settled = true
      clearTimeout(timeout)
      if (inflight.get(inflightKey) === entry) inflight.delete(inflightKey)
      controllers?.delete(controller)
    }
  })()
  return subscribePrediction(entry, parentSignal)
}

// Each HTTP caller owns a subscription, rather than the shared model stream.
// Disconnecting the last caller cancels work; one disconnect cannot cancel peers.
function subscribePrediction(entry, signal) {
  entry.subscribers += 1
  return new Promise((resolve) => {
    let finished = false
    const finish = (result) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', onAbort)
      entry.subscribers -= 1
      if (entry.subscribers === 0 && !entry.settled) entry.controller.abort()
      resolve(result)
    }
    const onAbort = () => finish({ skipped: 'aborted' })
    if (signal?.aborted) onAbort()
    else {
      signal?.addEventListener('abort', onAbort, { once: true })
      entry.promise.then(finish)
    }
  })
}

function sendJson(res, status, payload) {
  if (res.destroyed || res.writableEnded) return
  const body = Buffer.from(JSON.stringify(payload))
  if (!res.headersSent) res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function isLoopback(address) {
  if (typeof address !== 'string') return false
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return plain === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(plain)
}

function refused(ctx, req, res) {
  const connection = ctx.get('connection')
  let status
  if (typeof connection?.requestRejection === 'function') {
    status = connection.requestRejection(req)
  } else {
    status = localRejection(req)
  }
  if (status !== undefined) {
    sendJson(res, status, { ok: false, error: status === 401 ? 'unauthorized' : 'forbidden' })
    return true
  }
  return false
}

/** The same loopback/same-origin fence DSH's own host routes use. */
function localRejection(req) {
  if (!isLoopback(req.socket?.remoteAddress)) return 403
  const host = req.headers?.host
  if (host !== undefined) {
    if (!URL.canParse('http://' + host)) return 403
    const name = new URL('http://' + host).hostname
    if (name !== 'localhost' && name !== '[::1]' && !/^127\.\d+\.\d+\.\d+$/.test(name)) return 403
  }
  const site = req.headers?.['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 403
  const origin = req.headers?.origin
  if (origin === undefined) return undefined
  if (!URL.canParse(origin)) return 403
  return new URL(origin).host === host ? undefined : 403
}

function readJson(req, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (chunk) => {
      if (over) return
      size += chunk.length
      if (size > limit) {
        over = true
        resolve(null)
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => {
      if (over) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

async function handle(ctx, req, res, getOptions, cache, inflight, controllers) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  if (refused(ctx, req, res)) return

  const body = await readJson(req, 4096)
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const force = body?.force === true
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId)) {
    sendJson(res, 400, { ok: false, error: 'invalid session' })
    return
  }

  const options = getOptions()
  if (options.enabled === false) {
    sendJson(res, 200, { ok: true, text: null, reason: 'disabled' })
    return
  }

  // Publish the effective model budget before waiting for a result, so the
  // client can bound body/transport time without pre-empting a 60 s model call.
  // Keep JSON framing; streamed headers do not expose any session content.
  if (typeof res.flushHeaders === 'function') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-dshcp-timeout-ms': String(predictionTimeoutMs(options.timeoutMs)),
    })
    res.flushHeaders()
  }

  const controller = new AbortController()
  // Attach to the RESPONSE close, not the request close: Node emits
  // IncomingMessage "close" as soon as the request body has been read, which is
  // before readJson returns. The response close with writableEnded === false is
  // the real client-disconnect signal.
  const onClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.on('close', onClose)
  if (res.destroyed) controller.abort()

  let result
  try {
    result = await predict(ctx, sessionId, options, cache, inflight, controller.signal, controllers, force)
  } finally {
    res.off?.('close', onClose)
  }
  if (res.destroyed || res.writableEnded) return
  if (!result || result.skipped) {
    const payload = { ok: true, text: null, reason: result?.skipped ?? 'unavailable', debug: options.debug === true }
    if (options.debug && typeof result?.raw === 'string') payload.raw = result.raw
    sendJson(res, 200, payload)
    return
  }
  if (!result.text) {
    sendJson(res, 200, { ok: true, text: null, reason: 'empty' })
    return
  }

  sendJson(res, 200, {
    ok: true,
    text: result.text,
    turnId: result.turnId,
    model: result.model,
    provider: result.provider,
    promptVersion: result.promptVersion,
    contextMode: result.contextMode,
    cacheable: result.cacheable === true,
    contextChars: result.contextChars,
    stub: result.stub === true,
  })
}

export const name = PLUGIN_ID
export const inject = ['sessions', 'llm']

/**
 * Resolve the live options at request time. The patch config is the base;
 * the volatile `enabled` field comes from the plugin's config form, which
 * the Host settings service exposes under the plugin entry id.
 */
function currentOptions(config, settings) {
  const base = optionsOf(config)
  if (config !== null && typeof config?.enabled?.get === 'function') {
    try { base.enabled = config.enabled.get() } catch {}
  }
  if (settings !== null && typeof settings?.describe === 'function') {
    try {
      const row = settings.describe().find((entry) => entry.ns === PLUGIN_ID)
      if (row?.value !== undefined && typeof row.value.enabled === 'boolean') {
        base.enabled = row.value.enabled
      }
    } catch {}
  }
  // A volatile accessor that could not be read must not become an object that
  // every `=== false` check silently treats as enabled.
  return { ...base, enabled: base.enabled !== false }
}

export function apply(ctx, config = {}) {
  let settingsService = null
  let current = () => currentOptions(config, null)
  const cache = new Map()
  const inflight = new Map()
  /** Controllers for predictions whose stream is still live; aborted on dispose. */
  const controllers = new Set()

  // The user-facing switch rides the plugin's volatile Config field. The
  // patch config is the base layer; the settings form overlays the user's
  // choice. `auto:false` keeps this plugin's settings surface to our row.
  ctx.inject(['settings'], (scopeCtx) => {
    try {
      settingsService = scopeCtx.settings
      scopeCtx.effect(
        () => scopeCtx.settings.configure({ auto: false }, ctx.fiber),
        'composer-predictions: settings presentation',
      )
      current = () => currentOptions(config, settingsService)
    } catch (error) {
      ctx.logger?.warn?.('composer-predictions: settings setup failed: ' + (error?.message ?? String(error)))
    }
  })

  // Drop stale predictions as soon as a new turn starts.
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start') return
    for (const key of [...cache.keys()]) {
      if (key.startsWith(session.id + ':')) cache.delete(key)
    }
  }), 'composer-predictions: turn invalidation')

  ctx.effect(() => ctx.on('llm/adapters-updated', () => {
    cache.clear()
    for (const controller of controllers) controller.abort()
  }), 'composer-predictions: adapter invalidation')

  // Plugin unload must not leave an in-flight model stream running.
  ctx.effect(() => () => {
    for (const controller of controllers) controller.abort()
    controllers.clear()
    cache.clear()
    inflight.clear()
  }, 'composer-predictions: dispose')

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const server = scope.webServer
      if (server === undefined || server === null) return
      let dispose = null
      try {
        dispose = server.register({
          kind: 'exact',
          path: ROUTE,
          handler: (req, res) => {
            void handle(ctx, req, res, current, cache, inflight, controllers).catch((error) => {
              ctx.logger?.warn?.('composer-predictions: route failed')
              sendJson(res, 500, { ok: false, error: 'internal' })
            })
          },
        })
      } catch (error) {
        ctx.logger?.warn?.('composer-predictions: route unavailable: ' + (error?.message ?? String(error)))
      }
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'composer-predictions: route')
  })
}

// Test seam for the pure helpers.
export {
  latestClosedTurn,
  buildConversation,
  parseSuggestion,
  clampSuggestion,
  splitGraphemes,
  optionsOf,
  resolveCall,
  failureResult,
  generate,
  currentOptions,
  PREDICTION_SYSTEM,
  PREDICTION_INSTRUCTION,
  PROMPT_VERSION,
}
