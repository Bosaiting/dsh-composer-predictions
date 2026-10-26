/**
 * dsh-composer-predictions — Client half (P0/P1).
 *
 * Renders a ghost suggestion in the composer overlay, requests it from the
 * Host route after a turn ends, and accepts it with Tab through the public
 * InputActions.captureInsertion()/insertText() seam.
 *
 * Deliberately does not touch Lexical directly: the ghost is a pointer-events
 * none overlay, and acceptance is one undoable plain-text insertion.
 */
window.__ModuleLoader__.load({
  id: 'dsh-composer-predictions',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var NS = 'composerPredictions'
    var STYLE_ID = 'dsh-composer-predictions/styles.css'
    var ROUTE = '/dsh-composer-predictions/predict'

    var CSS = [
      // The Claude-style editor paints an opaque sibling at z-index:2 after
      // the overlay slot. Keep predictions above that editor background.
      '.dshcp-layer{position:absolute;left:0;top:0;width:100%;height:0;z-index:3;pointer-events:none;overflow:visible}',
      '.dshcp-ghost{box-sizing:border-box;position:absolute;top:var(--dshcp-top,0);left:var(--dshcp-left,0);width:var(--dshcp-width,0);height:auto;padding:var(--dshcp-pad-top,0) var(--dshcp-pad-right,0) 0 var(--dshcp-pad-left,0);font-family:var(--dshcp-font-family,inherit);font-size:var(--dshcp-font-size,inherit);font-weight:var(--dshcp-font-weight,inherit);font-style:var(--dshcp-font-style,inherit);line-height:var(--dshcp-line-height,inherit);letter-spacing:var(--dshcp-letter-spacing,normal);text-align:var(--dshcp-text-align,left);word-spacing:var(--dshcp-word-spacing,normal);text-transform:var(--dshcp-text-transform,none);direction:var(--dshcp-direction,ltr);font-stretch:var(--dshcp-font-stretch,normal);font-variant:var(--dshcp-font-variant,normal);font-feature-settings:var(--dshcp-font-feature-settings,normal);font-variation-settings:var(--dshcp-font-variation-settings,normal);color:var(--dsw-alias-label-caption);user-select:none;pointer-events:none;overflow:visible}',
      '.dshcp-ghost-text{display:flow-root;overflow:hidden;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;max-height:var(--dshcp-max-height,72px);opacity:.62}',
      '.dshcp-avoid{float:right;width:var(--dshcp-avoid-width,0);height:var(--dshcp-max-height,24px);shape-outside:inset(var(--dshcp-avoid-top,0) 0 0 0);pointer-events:none}',
      '.dshcp-actions{position:absolute;right:4px;bottom:0;z-index:3;display:flex;align-items:center;gap:4px;pointer-events:auto}',
      '.dshcp-action{appearance:none;border:none;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap;cursor:pointer;pointer-events:auto}',
      '.dshcp-action:hover{color:var(--dsw-alias-label-secondary)}',
      '.dshcp-action:disabled{opacity:.5;cursor:default}',
      '.dshcp-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.dshcp-action[data-regen]{min-width:22px;font-size:13px;line-height:14px}',
      '.dshcp-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      '[data-ds-dark-theme] .dshcp-ghost-text{color:var(--dsw-alias-label-secondary);opacity:.58}',
      '[data-ds-dark-theme] .dshcp-action{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshcp-setting-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:12px 0}',
      '.dshcp-setting-copy{min-width:0}',
      '.dshcp-setting-title{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dshcp-setting-desc{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshcp-setting-stats{margin-top:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshcp-reset{appearance:none;border:none;padding:0;background:none;color:var(--dsw-alias-link);font-size:11px;line-height:16px;cursor:pointer}',
      '.dshcp-reset:hover{text-decoration:underline}',
      '.dshcp-setting-status{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}',
      '.dshcp-switch{position:relative;flex:none;width:36px;height:20px;margin-top:2px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background-color .15s}',
      '.dshcp-switch[data-on]{background:var(--dsw-alias-button-info-fill)}',
      '.dshcp-switch:disabled{opacity:.5;cursor:not-allowed}',
      '.dshcp-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}',
      '.dshcp-switch[data-on] .dshcp-switch-thumb{transform:translateX(16px)}',
      '[data-dsh-cp-visible] [data-composer-placeholder]{opacity:0!important}',
      // The theme's inline editor rule is more specific and otherwise keeps
      // the field at one line. The preview measures its own wrapped height.
      '[data-composer-card][data-dsh-cp-visible] [data-composer-input]{min-height:var(--dshcp-editor-min-height,1lh)!important}',
      '@media (prefers-reduced-motion: reduce){.dshcp-switch,.dshcp-switch-thumb{transition:none}}',
    ].join('\n')

    var zh = {
      hint: 'Tab 接受',
      regenerate: '重新生成',
      regenerating: '正在重新生成',
      a11ySuggestion: '建议：{text}。按 Tab 接受，或使用提示按钮插入；按 Esc 忽略本轮建议。',
      stats: '本机统计：展示 {shown} 次 · 接受 {accepted} 次 · 重新生成 {regenerated} 次',
      resetStats: '重置统计',
      settingTitle: '预测下一句',
      settingDescription: '对话完成后给出下一句建议；按 Tab 或点击提示插入，按 Esc 忽略本轮建议。',
      recentStatus: '最近预测：{reason}{timing}',
      retry: '重试预测',
      'reason.idle': '尚未请求',
      'reason.requesting': '正在生成',
      'reason.ready': '建议已生成',
      'reason.cached': '已恢复本轮建议',
      'reason.dismissed': '本轮已忽略（Esc）',
      'reason.accepted': '已填入草稿',
      'reason.disabled': '功能已关闭',
      'reason.background': '窗口在后台，恢复可见后再预测',
      'reason.conflict': '已暂停，其他建议插件优先：{name}',
      'reason.auth': '模型服务认证失败，请检查登录或凭据',
      'reason.rate-limit': '请求过于频繁，请稍后重试',
      'reason.quota': '模型额度不足',
      'reason.timeout': '生成超时，可重试',
      'reason.busy': '预测任务繁忙，请稍后重试',
      'reason.abstained': '没有合适的下一句建议',
      'reason.no-turn': '正在等待本轮对话完成',
      'reason.no-session': '会话暂不可用',
      'reason.no-model': '尚未选择模型',
      'reason.no-request-header': '会话模型信息尚未就绪',
      'reason.no-finish': '模型响应未完整结束，可重试',
      'reason.finish-max-tokens': '模型输出达到长度限制，可重试',
      'reason.empty': '没有合适的下一句建议',
      'reason.context-window': '上下文超出模型限制',
      'reason.invalid-config': '模型配置不兼容',
      'reason.unavailable': '模型服务暂不可用',
      'reason.network': '连接失败，可重试',
      'reason.aborted': '请求已取消',
      'reason.error': '预测未成功，可重试',
    }
    var en = {
      hint: 'Tab to accept',
      regenerate: 'Regenerate',
      regenerating: 'Regenerating',
      a11ySuggestion: 'Suggestion: {text}. Press Tab or use the hint button to insert; press Escape to dismiss for this turn.',
      stats: 'Local stats: {shown} shown · {accepted} accepted · {regenerated} regenerated',
      resetStats: 'Reset stats',
      settingTitle: 'Predict next message',
      settingDescription: 'Suggests your next message after a turn. Tab or click inserts; Escape dismisses for this turn.',
      recentStatus: 'Latest prediction: {reason}{timing}',
      retry: 'Retry prediction',
      'reason.idle': 'Not requested yet',
      'reason.requesting': 'Generating',
      'reason.ready': 'Suggestion ready',
      'reason.cached': 'Restored this turn’s suggestion',
      'reason.dismissed': 'Dismissed for this turn (Esc)',
      'reason.accepted': 'Inserted into draft',
      'reason.disabled': 'Feature disabled',
      'reason.background': 'Waiting until the window is visible',
      'reason.conflict': 'Paused for another suggestion plugin: {name}',
      'reason.auth': 'Model authentication failed; check your login or credentials',
      'reason.rate-limit': 'Rate limited; try again later',
      'reason.quota': 'Model quota exhausted',
      'reason.timeout': 'Generation timed out; retry available',
      'reason.busy': 'Prediction service busy; try again later',
      'reason.abstained': 'No useful next message',
      'reason.no-turn': 'Waiting for a completed turn',
      'reason.no-session': 'Session unavailable',
      'reason.no-model': 'No model selected',
      'reason.no-request-header': 'Session model information is not ready',
      'reason.no-finish': 'Incomplete model response; retry available',
      'reason.finish-max-tokens': 'Model output limit reached; retry available',
      'reason.empty': 'No useful next message',
      'reason.context-window': 'Model context limit exceeded',
      'reason.invalid-config': 'Incompatible model configuration',
      'reason.unavailable': 'Model service unavailable',
      'reason.network': 'Connection failed; retry available',
      'reason.aborted': 'Request cancelled',
      'reason.error': 'Prediction failed; retry available',
    }

    function injectStyle() {
      if (typeof document === 'undefined') return null
      var previous = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')
      if (previous !== null) previous.remove()
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-composer-predictions'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return tag
    }

    var settingsRef = null
    // Only ephemeral, content-free diagnostics are shared with Settings.
    var status = { reason: 'idle', ms: null, conflict: '', canRetry: false }
    var statusListeners = new Set()
    var retryPrediction = null
    function publishStatus(patch) {
      var next = { ...status, ...patch }
      if (JSON.stringify(next) === JSON.stringify(status)) return
      status = next
      for (var listener of [...statusListeners]) listener()
    }
    function useStatus() {
      return React.useSyncExternalStore(function (listener) {
        statusListeners.add(listener)
        return function () { statusListeners.delete(listener) }
      }, function () { return status })
    }

    // Memory only: never save conversation text or refusal state to storage.
    var offers = new Map()
    // Native turnEnds maps are replaced when the timeline changes; streaming
    // publications sharing the map can reuse this scalar without rescanning it.
    var turnStamps = new WeakMap()
    function closedTurnStamp(snapshot) {
      var ends = snapshot?.legacy?.turnEnds
      if (!ends || typeof ends.entries !== 'function') return ''
      var cached = turnStamps.get(ends)
      if (cached !== undefined) return cached
      var turn = -1, seq = 0
      for (var entry of ends.entries()) {
        if (Number(entry[0]) > turn) { turn = Number(entry[0]); seq = entry[1] }
      }
      var stamp = turn < 0 ? '' : turn + ':' + seq
      turnStamps.set(ends, stamp)
      return stamp
    }
    function isDocumentVisible() {
      return typeof document === 'undefined' || document.visibilityState !== 'hidden'
    }
    function subscribeVisibility(listener) {
      document.addEventListener('visibilitychange', listener)
      return function () { document.removeEventListener('visibilitychange', listener) }
    }
    function useDocumentVisible() {
      return React.useSyncExternalStore(subscribeVisibility, isDocumentVisible)
    }
    function settingsKey(snapshot) {
      return JSON.stringify([snapshot.revision ?? null, snapshot.value ?? null])
    }
    function rememberOffer(sessionId, stamp, configKey, prediction, disposition) {
      offers.delete(sessionId)
      offers.set(sessionId, { stamp: stamp, configKey: configKey, prediction: prediction,
        disposition: disposition, at: Date.now() })
      while (offers.size > 40) offers.delete(offers.keys().next().value)
    }
    function readOffer(sessionId, stamp, configKey) {
      var entry = offers.get(sessionId)
      if (!entry) return null
      // Without a native closed-turn stamp, ask the Host rather than restoring
      // an offer whose turn might have changed while this view was unmounted.
      if (!stamp) return null
      if (entry.stamp !== stamp || entry.configKey !== configKey
        || (entry.disposition === 'offered' && Date.now() - entry.at > 600000)) {
        offers.delete(sessionId)
        return null
      }
      offers.delete(sessionId)
      offers.set(sessionId, entry)
      return entry
    }

    var OWN_ID = 'dsh-composer-predictions'
    var LOWER_PRIORITY_ID = 'dsh-composer-prediction'
    function findConflict(entries, markers, pluginIds) {
      if ((pluginIds || []).includes('dsh-next-hint')) return 'dsh-next-hint'
      var declared = new Set()
      for (var marker of markers || []) {
        var name = marker.getAttribute('data-composer-ghost') || 'another plugin'
        declared.add(name)
        if (name === OWN_ID || name === LOWER_PRIORITY_ID) continue
        var rawPriority = marker.getAttribute('data-composer-ghost-priority')
        var priority = String(rawPriority ?? '').trim() === '' ? 200 : Number(rawPriority)
        if (!Number.isFinite(priority)) priority = 200
        if (priority > 100 || (priority === 100 && name < OWN_ID)) return name
      }
      for (var entry of entries || []) {
        var id = entry.options?.id || ''
        var owner = entry.registrant || ''
        if (id === OWN_ID || owner === OWN_ID || id === 'composer-predict-ghost' || owner === LOWER_PRIORITY_ID) continue
        if (id === 'dsh-next-hint' || owner === 'dsh-next-hint') return 'dsh-next-hint'
        // A painted peer's explicit priority takes precedence over its slot name.
        if (declared.has(owner) || declared.has(id)) continue
        // Help, command completion and generic hints are not necessarily ghosts.
        // Retain a narrow fallback for peers explicitly naming a ghost overlay.
        var ghostName = /(?:^|[-_:/.])ghost(?:$|[-_:/.])/i
        if (ghostName.test(id) || ghostName.test(owner)) return id || owner
      }
      return ''
    }

    function clientDeadlineMs(value) {
      var budget = Number(value)
      // Until Host headers arrive (or against an older Host), allow its full
      // supported 60 s budget. Transport gets another 5 s, never a shorter cap.
      return (Number.isFinite(budget) && budget >= 1000 && budget <= 60000 ? budget : 60000) + 5000
    }

    function useComposerComposition(anchorRef, sessionId) {
      var guard = React.useRef({ active: false, native: false, until: 0 })
      var state = React.useState(false)
      var getEditor = React.useCallback(function () {
        return anchorRef.current?.closest('[data-composer-card]')?.querySelector('[data-composer-input]') || null
      }, [])
      var isBlocked = React.useCallback(function () {
        var native = getEditor()?.hasAttribute('data-composer-composing') === true
        if (!native && guard.current.native) guard.current.until = Math.max(guard.current.until, Date.now() + 10)
        guard.current.native = native
        return native || guard.current.active || Date.now() < guard.current.until
      }, [getEditor])
      React.useLayoutEffect(function () {
        var editor = getEditor(), timer = null
        guard.current = { active: false, native: false, until: 0 }
        function refresh() {
          if (timer !== null) clearTimeout(timer)
          timer = null
          state[1](isBlocked())
          var remaining = guard.current.until - Date.now()
          if (remaining > 0) timer = setTimeout(refresh, remaining)
        }
        function start() { guard.current.active = true; refresh() }
        function end() { guard.current.active = false; guard.current.until = Date.now() + 10; refresh() }
        editor?.addEventListener('compositionstart', start, true)
        editor?.addEventListener('compositionend', end, true)
        var observer = editor && typeof MutationObserver !== 'undefined' ? new MutationObserver(refresh) : null
        observer?.observe(editor, { attributes: true, attributeFilter: ['data-composer-composing'] })
        refresh()
        return function () {
          if (timer !== null) clearTimeout(timer)
          observer?.disconnect()
          editor?.removeEventListener('compositionstart', start, true)
          editor?.removeEventListener('compositionend', end, true)
        }
      }, [sessionId, getEditor, isBlocked])
      return { blocked: state[0], isBlocked: isBlocked, getEditor: getEditor }
    }
    var EMPTY_SETTINGS = {
      status: 'unavailable',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: 'memory',
    }

    var STATS_KEY = 'dsh-composer-predictions.stats.v1'
    var EMPTY_STATS = { shown: 0, accepted: 0, regenerated: 0 }

    function readStats() {
      try {
        if (typeof localStorage === 'undefined') return { ...EMPTY_STATS }
        var raw = localStorage.getItem(STATS_KEY)
        var parsed = raw === null ? null : JSON.parse(raw)
        return {
          shown: Math.max(0, Number(parsed?.shown) || 0),
          accepted: Math.max(0, Number(parsed?.accepted) || 0),
          regenerated: Math.max(0, Number(parsed?.regenerated) || 0),
        }
      } catch {
        return { ...EMPTY_STATS }
      }
    }

    var stats = readStats()
    var statsListeners = new Set()

    function getStatsSnapshot() {
      return stats
    }

    function subscribeStats(listener) {
      statsListeners.add(listener)
      return function () {
        statsListeners.delete(listener)
      }
    }

    function writeStats(next) {
      stats = next
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STATS_KEY, JSON.stringify(next))
      } catch {}
      for (var listener of [...statsListeners]) {
        try { listener() } catch {}
      }
    }

    function bumpStat(name) {
      writeStats({ ...stats, [name]: (stats[name] || 0) + 1 })
    }

    function resetStats() {
      writeStats({ ...EMPTY_STATS })
    }

    function useStatsSnapshot() {
      return React.useSyncExternalStore(subscribeStats, getStatsSnapshot)
    }

    function getSettingsSnapshot() {
      return settingsRef === null ? EMPTY_SETTINGS : settingsRef.getSnapshot()
    }

    function subscribeSettings(listener) {
      if (settingsRef === null) return function () {}
      return settingsRef.subscribe(listener)
    }

    function useSettingsSnapshot() {
      return React.useSyncExternalStore(subscribeSettings, getSettingsSnapshot)
    }

    /**
     * Fail closed until the config form has delivered its first value. A
     * loading form used to read as "enabled" and could fire one prediction
     * after the user had already switched the feature off.
     */
    function isFeatureEnabled(snapshot) {
      return snapshot.status === 'ready' && snapshot.value?.enabled !== false
    }

    function isBlankDraft(value) {
      return typeof value !== 'string'
        || value.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\n/g, '') === ''
    }

    /**
     * The one decision Tab acceptance uses. Kept pure so the bundle test can
     * pin the "settings off / new turn / typing / attachment / IME" guards.
     */
    function canAccept(prediction, draft, phase, attachments, composing, enabled, running) {
      return enabled === true
        && running !== true
        && composing !== true
        && prediction !== null
        && prediction !== undefined
        && typeof prediction.text === 'string'
        && prediction.text !== ''
        && isBlankDraft(draft)
        && phase === 'plain'
        && attachments === 0
    }

    function isVisibleElement(element) {
      if (element === null || element === undefined) return false
      if (element.getClientRects().length === 0) return false
      var style = window.getComputedStyle(element)
      return style.visibility !== 'hidden' && style.display !== 'none'
    }

    function hasOpenMenu() {
      // A primitive menu may be portaled anywhere; its trigger keeps
      // aria-expanded in sync in every DSH menu implementation.
      var expanded = document.querySelectorAll(
        '[aria-haspopup="listbox"][aria-expanded="true"],' +
        '[aria-haspopup="menu"][aria-expanded="true"],' +
        '[aria-haspopup="dialog"][aria-expanded="true"]'
      )
      for (var e = 0; e < expanded.length; e += 1) {
        if (isVisibleElement(expanded[e])) return true
      }
      var nodes = document.querySelectorAll('[role="listbox"],[role="menu"]')
      for (var i = 0; i < nodes.length; i += 1) {
        if (isVisibleElement(nodes[i])) return true
      }
      return false
    }

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

    function useGhostPosition(rootRef, visible, text) {
      React.useLayoutEffect(function () {
        if (!visible || rootRef.current === null) return
        var root = rootRef.current
        var card = root.closest('[data-composer-card]')
        if (card === null) return
        // The slot renderer may wrap entries; offsetParent is the actual
        // containing block of the absolutely positioned layer.
        var container = root.offsetParent || root.parentElement
        if (container === null) return
        var editor = card.querySelector('[data-composer-input]')
        if (editor === null) return
        var ghostText = root.querySelector('.dshcp-ghost-text')
        if (ghostText === null) return
        // React owns this empty span; only this layout effect owns its text.
        var content = root.querySelector('.dshcp-ghost-content')
        if (content === null) return
        var actions = root.querySelector('.dshcp-actions')

        var disposed = false
        var frame = null
        var resizeFrame = null
        var resizeDirty = false
        var layoutKey = null
        function set(name, value) {
          if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value)
        }
        function schedule() {
          if (disposed || frame !== null) return
          frame = window.requestAnimationFrame(function () { frame = null; place() })
        }
        function onResize() {
          if (disposed) return
          if (resizeFrame !== null) { resizeDirty = true; return }
          // ResizeObserver runs before paint. Deferring its first placement to
          // the next frame makes a transitioning sidebar visibly misalign.
          // Place once now and share a frame latch across both observers.
          if (frame !== null) { window.cancelAnimationFrame(frame); frame = null }
          resizeDirty = false
          resizeFrame = window.requestAnimationFrame(function () {
            resizeFrame = null
            // A later delivery may carry a genuinely newer geometry. Drain
            // that work once next frame rather than dropping the notification.
            if (resizeDirty) onResize()
          })
          place()
        }
        function fontLoaded() { layoutKey = null; schedule() }
        function place() {
          if (disposed || !root.isConnected) return
          var containerRect = container.getBoundingClientRect()
          var editorRect = editor.getBoundingClientRect()
          var style = window.getComputedStyle(editor)
          var scale = editor.offsetWidth > 0 ? editorRect.width / editor.offsetWidth : 1
          if (!isFinite(scale) || scale <= 0) scale = 1
          var actionWidth = actions === null ? 0 : actions.getBoundingClientRect().width / scale
          var key = JSON.stringify([text, editorRect.width / scale, actionWidth,
            style.paddingTop, style.paddingRight, style.paddingLeft, style.paddingBottom,
            style.borderTopWidth, style.borderBottomWidth, style.boxSizing,
            style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle,
            style.fontStretch, style.fontVariant, style.fontFeatureSettings, style.fontVariationSettings,
            style.lineHeight, style.letterSpacing, style.wordSpacing, style.textAlign,
            style.textTransform, style.direction])
          if (key !== layoutKey) {
            layoutKey = key
            set('--dshcp-width', (editorRect.width / scale) + 'px')
            set('--dshcp-pad-top', style.paddingTop)
            set('--dshcp-pad-right', style.paddingRight)
            set('--dshcp-pad-left', style.paddingLeft)
            set('--dshcp-font-family', style.fontFamily)
            set('--dshcp-font-size', style.fontSize)
            set('--dshcp-font-weight', style.fontWeight)
            set('--dshcp-font-style', style.fontStyle)
            set('--dshcp-line-height', style.lineHeight)
            set('--dshcp-letter-spacing', style.letterSpacing)
            set('--dshcp-text-align', style.textAlign)

            set('--dshcp-word-spacing', style.wordSpacing)
            set('--dshcp-text-transform', style.textTransform)
            set('--dshcp-direction', style.direction)
            set('--dshcp-font-stretch', style.fontStretch)
            set('--dshcp-font-variant', style.fontVariant)
            set('--dshcp-font-feature-settings', style.fontFeatureSettings)
            set('--dshcp-font-variation-settings', style.fontVariationSettings)
            // A float shape reserves only the right-hand end of the final line.
            // Earlier lines keep the editor's full content width.
            var lineHeight = parseFloat(style.lineHeight)
            if (!isFinite(lineHeight) || lineHeight <= 0) {
              lineHeight = (parseFloat(style.fontSize) || 14) * 1.45
            }
            var padTop = parseFloat(style.paddingTop) || 0
            var padRight = parseFloat(style.paddingRight) || 0
            set('--dshcp-avoid-width', Math.max(0, actionWidth + 12 - padRight) + 'px')
            var range = document.createRange()
            function bounds(value) {
              if (content.textContent !== value) content.textContent = value
              range.selectNodeContents(content)
              var rect = range.getBoundingClientRect()
              return (rect.bottom - ghostText.getBoundingClientRect().top) / scale
            }
            var value = typeof text === 'string' ? text : ''
            var lines = 1
            for (; lines <= 3; lines += 1) {
              set('--dshcp-max-height', (lines * lineHeight) + 'px')
              set('--dshcp-avoid-top', ((lines - 1) * lineHeight) + 'px')
              var bottom = bounds(value)
              // If all text fits above the button line, extend the exclusion
              // into the preceding line so buttons never get an empty row.
              if (lines > 1 && bottom <= (lines - 1) * lineHeight + 0.5) {
                set('--dshcp-avoid-top', ((lines - 2) * lineHeight) + 'px')
                bottom = bounds(value)
              }
              if (bottom <= lines * lineHeight + 0.5 || lines === 3) break
            }
            // A flow-root supports float wrapping; clamp its visible text with
            // an ellipsis while keeping the full suggestion for Tab acceptance.
            if (bounds(value) > lines * lineHeight + 0.5) {
              var chars = splitGraphemes(value)
              var low = 0, high = chars.length
              while (low < high) {
                var mid = Math.ceil((low + high) / 2)
                if (bounds(chars.slice(0, mid).join('') + '…') <= lines * lineHeight + 0.5) low = mid
                else high = mid - 1
              }
              bounds(chars.slice(0, low).join('') + '…')
            }
            var editorHeight = lines * lineHeight
            if (style.boxSizing === 'border-box') {
              editorHeight += padTop + (parseFloat(style.paddingBottom) || 0)
                + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
            }
            if (card.style.getPropertyValue('--dshcp-editor-min-height') !== editorHeight + 'px') {
              card.style.setProperty('--dshcp-editor-min-height', editorHeight + 'px')
            }

            // A sticky composer moves when its height changes; measure again so
            // the overlay and the toolbar stay aligned in the same layout pass.
            editorRect = editor.getBoundingClientRect()
            containerRect = container.getBoundingClientRect()
          }
          set('--dshcp-top', ((editorRect.top - containerRect.top) / scale) + 'px')
          set('--dshcp-left', ((editorRect.left - containerRect.left) / scale) + 'px')
          set('--dshcp-height', (editorRect.height / scale) + 'px')
        }

        // Only a visible preview owns the temporary editor height.
        card.setAttribute('data-dsh-cp-visible', '')
        place()
        var observer = new ResizeObserver(onResize)
        observer.observe(card)
        observer.observe(editor)
        observer.observe(ghostText)
        if (actions !== null) observer.observe(actions)
        var docObserver = new ResizeObserver(onResize)
        docObserver.observe(document.documentElement)
        var mutation = null
        if (typeof MutationObserver !== 'undefined') {
          mutation = new MutationObserver(schedule)
          // Theme/font switches can use arbitrary data attributes on any
          // ancestor, or a class/style on the editor itself.
          for (var ancestor = editor; ancestor !== null; ancestor = ancestor.parentElement) {
            mutation.observe(ancestor, { attributes: true })
          }
        }
        window.addEventListener('resize', schedule)
        window.addEventListener('scroll', schedule, true)
        var visualViewport = window.visualViewport
        if (visualViewport !== null && visualViewport !== undefined) {
          visualViewport.addEventListener('resize', schedule)
        }
        if (document.fonts !== undefined) {
          document.fonts.ready.then(function () { if (!disposed) fontLoaded() }, function () {})
          document.fonts.addEventListener?.('loadingdone', fontLoaded)
        }

        return function () {
          disposed = true
          if (frame !== null) window.cancelAnimationFrame(frame)
          if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
          document.fonts?.removeEventListener?.('loadingdone', fontLoaded)
          observer.disconnect()
          docObserver.disconnect()
          if (mutation !== null) mutation.disconnect()
          window.removeEventListener('resize', schedule)
          window.removeEventListener('scroll', schedule, true)
          if (visualViewport !== null && visualViewport !== undefined) {
            visualViewport.removeEventListener('resize', schedule)
          }
          card.removeAttribute('data-dsh-cp-visible')
          card.style.removeProperty('--dshcp-editor-min-height')
        }
      }, [visible, text])
    }

    function useTabAccept(prediction, draft, phase, attachments, composing, enabled, running, acceptPrediction, dismissPrediction, isComposing, getEditor) {
      React.useEffect(function () {
        function onKeyDown(event) {
          if (!enabled || running) return
          if (event.defaultPrevented) return
          if (event.key !== 'Tab' && event.key !== 'Escape') return
          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
          if (composing || event.isComposing || event.keyCode === 229) return
          if (!canAccept(prediction, draft, phase, attachments, composing, enabled, running)) return
          if (!(event.target instanceof Element)) return
          var card = event.target.closest('[data-composer-card]')
          if (card === null) return
          var editor = card.querySelector('[data-composer-input]')
          if (editor === null) return
          if (editor !== getEditor() || isComposing()) return
          if (!(event.target === editor || editor.contains(event.target))) return
          if (hasOpenMenu()) return

          event.preventDefault()
          event.stopImmediatePropagation()
          if (event.key === 'Escape') dismissPrediction()
          else acceptPrediction()
        }

        window.addEventListener('keydown', onKeyDown, true)
        return function () {
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [prediction, draft, phase, attachments, composing, enabled, running, acceptPrediction, dismissPrediction, isComposing, getEditor])
    }

    function PredictionOverlay(props) {
      var sessionId = props.sessionId
      var useSession = props.useSession
      var useInput = props.useInput
      var inputActions = props.inputActions
      var t = props.t

      var settingsSnapshot = useSettingsSnapshot()
      var enabled = isFeatureEnabled(settingsSnapshot)
      var documentVisible = useDocumentVisible()
      var diagnostic = useStatus()
      var conflict = diagnostic.conflict
      var configKey = settingsKey(settingsSnapshot)
      // Read only the native turn identity; the Host remains the transcript owner.
      var turnStamp = typeof props.useChat === 'function' ? props.useChat(closedTurnStamp) : ''
      var running = useSession(function (state) { return state.running })
      var draft = useInput(function (state) { return state.draft })
      var phase = useInput(function (state) { return state.phase })
      var attachmentCount = useInput(function (state) { return state.attachmentIds.length })
      var anchorRef = React.useRef(null)
      var composition = useComposerComposition(anchorRef, sessionId)
      var composing = composition.blocked
      var isComposerComposing = composition.isBlocked

      var predictionState = React.useState(null)
      var prediction = predictionState[0]
      var setPrediction = predictionState[1]
      var regeneratingState = React.useState(false)
      var regenerating = regeneratingState[0]
      var setRegenerating = regeneratingState[1]
      var shownKeyRef = React.useRef(null)
      var abortRef = React.useRef(null)
      var seqRef = React.useRef(0)
      /** Bumped on every new turn / session / disable; old responses are stale. */
      var epochRef = React.useRef(0)
      var retryRef = React.useRef(false)
      var retryTimerRef = React.useRef(null)
      var catchUpPendingRef = React.useRef(false)
      var catchUpAtRef = React.useRef(0)
      var mountedRef = React.useRef(false)
      var invalidateRequest = React.useCallback(function () {
        seqRef.current += 1
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current)
          retryTimerRef.current = null
        }
        if (abortRef.current !== null) {
          abortRef.current.abort()
          abortRef.current = null
          if (status.reason === 'requesting') publishStatus({ reason: 'aborted', ms: null })
        }
      }, [])
      var rootRef = React.useRef(null)
      var latestRef = React.useRef(null)
      var previousRunning = React.useRef(running)
      var previousConflict = React.useRef(conflict)
      var previousVisible = React.useRef(documentVisible)
      var dismissedRef = React.useRef(false)

      latestRef.current = {
        sessionId: sessionId,
        running: running,
        draft: draft,
        phase: phase,
        attachments: attachmentCount,
        composing: composing,
        enabled: enabled,
        conflict: conflict,
        stamp: turnStamp,
        configKey: configKey,
        visible: documentVisible,
      }

      var requestPrediction = React.useCallback(function (mode, force) {
        var latest = latestRef.current
        if (!mountedRef.current || latest === null) return
        if (latest.enabled === false) return
        if (!latest.visible || !isDocumentVisible()) return
        if (latest.conflict) return
        if (latest.running || latest.composing || isComposerComposing()) return
        if (!isBlankDraft(latest.draft) || latest.phase !== 'plain' || latest.attachments > 0) return
        if (!force && dismissedRef.current) return
        if (!force && abortRef.current !== null && !abortRef.current.signal.aborted) return
        if (!force && readOffer(sessionId, latest.stamp, latest.configKey)) return
        if (force) dismissedRef.current = false
        catchUpPendingRef.current = false

        invalidateRequest()
        var controller = new AbortController()
        abortRef.current = controller
        var seq = seqRef.current + 1
        seqRef.current = seq
        var epoch = epochRef.current
        var requestStamp = latest.stamp
        var requestConfigKey = latest.configKey
        var started = Date.now()
        function timedOut() {
          controller.abort()
          if (mountedRef.current && seq === seqRef.current && epoch === epochRef.current) {
            publishStatus({ reason: 'timeout', ms: Date.now() - started })
          }
        }
        var timer = setTimeout(timedOut, clientDeadlineMs())
        publishStatus({ reason: 'requesting', ms: null })
        if (force) setRegenerating(true)
        else setRegenerating(false)

        var requestSession = sessionId
        fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: requestSession, mode: mode, force: force === true }),
          signal: controller.signal,
          credentials: 'same-origin',
        }).then(function (response) {
          var budget = response.headers?.get?.('x-dshcp-timeout-ms')
          if (budget !== null && budget !== undefined) {
            clearTimeout(timer)
            timer = setTimeout(timedOut, Math.max(0, clientDeadlineMs(budget) - (Date.now() - started)))
          }
          if (!response.ok) return { reason: response.status === 401 || response.status === 403 ? 'auth'
            : response.status === 429 ? 'rate-limit' : 'error' }
          return response.json()
        }).then(function (data) {
          if (!mountedRef.current || controller.signal.aborted || seq !== seqRef.current || epoch !== epochRef.current) return
          var now = latestRef.current
          if (now === null || now.sessionId !== requestSession) return
          if (now.running || !now.visible || !isDocumentVisible()) return
          if (now.stamp !== requestStamp || now.configKey !== requestConfigKey || now.conflict) return
          // A response that lands during composition is still useful: the
          // ghost is hidden while composing and appears once composition ends.
          if (!isBlankDraft(now.draft) || now.phase !== 'plain' || now.attachments > 0) return
          if (data !== null && data.ok === true && typeof data.text === 'string' && data.text !== '') {
            if (requestStamp && data.turnId !== null && Number(data.turnId) !== Number(requestStamp.split(':')[0])) {
              publishStatus({ reason: 'no-turn', ms: Date.now() - started })
              return
            }
            var next = { text: data.text, turnId: data.turnId, sessionId: requestSession }
            setPrediction(next)
            rememberOffer(requestSession, requestStamp, requestConfigKey, next, 'offered')
            publishStatus({ reason: 'ready', ms: Date.now() - started })
            retryRef.current = false
            return
          }
          var knownReason = data?.reason
          if (!Object.prototype.hasOwnProperty.call(en, 'reason.' + knownReason)) knownReason = 'error'
          publishStatus({ reason: knownReason, ms: Date.now() - started })
          if (data !== null && data.reason === 'no-turn' && mode === 'catch_up' && !retryRef.current) {
            retryRef.current = true
            retryTimerRef.current = setTimeout(function () {
              retryTimerRef.current = null
              if (mountedRef.current && epoch === epochRef.current && seq === seqRef.current) {
                catchUpPendingRef.current = true
                catchUpAtRef.current = Date.now()
                requestPrediction('catch_up')
              }
            }, 900)
            return
          }
          // Regenerate keeps the previous suggestion if the new attempt
          // abstains or fails; a normal request clears it explicitly.
          if (!force) setPrediction(null)
        }).catch(function (error) {
          if (error && error.name === 'AbortError') return
          if (!mountedRef.current || seq !== seqRef.current || epoch !== epochRef.current) return
          publishStatus({ reason: 'network', ms: Date.now() - started })
          console.warn('[dsh-composer-predictions] prediction request failed', error)
        }).finally(function () {
          clearTimeout(timer)
          if (abortRef.current === controller) abortRef.current = null
          if (force && seq === seqRef.current) setRegenerating(false)
        })
      }, [sessionId, isComposerComposing])

      var acceptPrediction = React.useCallback(function () {
        if (!isDocumentVisible()) return false
        if (isComposerComposing()) return false
        if (latestRef.current?.sessionId !== prediction?.sessionId || latestRef.current?.conflict) return false
        if (!canAccept(prediction, draft, phase, attachmentCount, composing, enabled, running)) return false
        if (inputActions === undefined || inputActions === null) return false
        if (typeof inputActions.captureInsertion !== 'function' || typeof inputActions.insertText !== 'function') return false

        var accepted = false
        try {
          var span = inputActions.captureInsertion()
          accepted = inputActions.insertText(prediction.text, span) === true
          if (!accepted) {
            var retrySpan = inputActions.captureInsertion()
            accepted = inputActions.insertText(prediction.text, retrySpan) === true
          }
        } catch (error) {
          console.warn('[dsh-composer-predictions] insertText failed', error)
        }
        if (accepted) {
          var latest = latestRef.current
          dismissedRef.current = true
          rememberOffer(sessionId, latest.stamp, latest.configKey, null, 'accepted')
          publishStatus({ reason: 'accepted' })
          invalidateRequest()
          setPrediction(null)
          setRegenerating(false)
          bumpStat('accepted')
        }
        return accepted
      }, [prediction, draft, phase, attachmentCount, composing, enabled, running, inputActions, setPrediction, isComposerComposing])

      var dismissPrediction = React.useCallback(function () {
        var latest = latestRef.current
        dismissedRef.current = true
        rememberOffer(sessionId, latest.stamp, latest.configKey, null, 'dismissed')
        invalidateRequest()
        setPrediction(null)
        setRegenerating(false)
        publishStatus({ reason: 'dismissed' })
      }, [sessionId, invalidateRequest])

      var acceptFromAction = React.useCallback(function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        var card = event?.currentTarget?.closest?.('[data-composer-card]')
        var editor = card ? card.querySelector('[data-composer-input]') : null
        if (editor !== null && editor !== undefined && document.activeElement !== editor) {
          try { editor.focus() } catch {}
        }
        acceptPrediction()
      }, [acceptPrediction])

      var regenerate = React.useCallback(function () {
        if (regenerating) return
        bumpStat('regenerated')
        requestPrediction('manual', true)
      }, [regenerating, requestPrediction])

      React.useLayoutEffect(function () {
        epochRef.current += 1
        previousRunning.current = latestRef.current ? latestRef.current.running : running
        retryRef.current = false
        var cached = enabled && !running && !conflict ? readOffer(sessionId, turnStamp, configKey) : null
        dismissedRef.current = cached !== null && cached.disposition !== 'offered'
        setPrediction(cached?.prediction || null)
        if (cached !== null) publishStatus({ reason: cached.disposition === 'offered' ? 'cached' : cached.disposition, ms: null })
        setRegenerating(false)
        mountedRef.current = true
        invalidateRequest()
        catchUpPendingRef.current = cached === null
        catchUpAtRef.current = Date.now() + 350
        return function () {
          mountedRef.current = false
          epochRef.current += 1
          invalidateRequest()
        }
      }, [sessionId, requestPrediction, turnStamp, configKey, enabled])

      React.useEffect(function () {
        var wasRunning = previousRunning.current
        previousRunning.current = running
        if (running) {
          catchUpPendingRef.current = false
          epochRef.current += 1
          retryRef.current = false
          setPrediction(null)
          setRegenerating(false)
          dismissedRef.current = false
          offers.delete(sessionId)
          invalidateRequest()
          return
        }
        if (wasRunning && isDocumentVisible()) {
          catchUpPendingRef.current = true
          catchUpAtRef.current = Date.now() + 400
        }
      }, [running, requestPrediction])

      React.useEffect(function () {
        if (!isBlankDraft(draft) || attachmentCount > 0 || phase !== 'plain') {
          // Existing offers survive temporary input guards. In-flight replies
          // are still cancelled and can never resurrect after a draft edit.
          setRegenerating(false)
          invalidateRequest()
        }
      }, [draft, attachmentCount, phase])

      React.useEffect(function () {
        if (!enabled) {
          catchUpPendingRef.current = false
          epochRef.current += 1
          setPrediction(null)
          setRegenerating(false)
          offers.clear()
          dismissedRef.current = false
          publishStatus({ reason: 'disabled' })
          invalidateRequest()
          return
        }
      }, [enabled, requestPrediction])

      React.useEffect(function () {
        var wasVisible = previousVisible.current
        previousVisible.current = documentVisible
        if (!documentVisible) {
          invalidateRequest()
          setRegenerating(false)
          if (enabled) publishStatus({ reason: 'background', ms: null })
          return
        }
        if (!wasVisible && enabled) {
          var latest = latestRef.current
          var cached = readOffer(sessionId, latest.stamp, latest.configKey)
          publishStatus({ reason: cached ? (cached.disposition === 'offered' ? 'cached' : cached.disposition)
            : dismissedRef.current ? 'dismissed' : 'idle', ms: null })
          catchUpPendingRef.current = !cached && !dismissedRef.current
          catchUpAtRef.current = Date.now() + 350
        }
      }, [documentVisible, enabled, requestPrediction])

      React.useEffect(function () {
        var previous = previousConflict.current
        previousConflict.current = conflict
        if (!conflict) {
          if (previous && !prediction && !dismissedRef.current) {
            catchUpPendingRef.current = true
            catchUpAtRef.current = Date.now() + 300
          }
          return
        }
        invalidateRequest()
        setRegenerating(false)
        publishStatus({ reason: 'conflict' })
      }, [conflict])

      // Preserve intent while a temporary guard blocks the initial request.
      // Only starting a request consumes it; a failure is not an automatic loop.
      React.useEffect(function () {
        if (!catchUpPendingRef.current || !enabled || !documentVisible || running || composing || conflict
          || !isBlankDraft(draft) || phase !== 'plain' || attachmentCount > 0 || isComposerComposing()) return
        var timer = setTimeout(function () {
          if (catchUpPendingRef.current) requestPrediction('catch_up')
        }, Math.max(0, catchUpAtRef.current - Date.now()))
        return function () { clearTimeout(timer) }
      }, [sessionId, turnStamp, configKey, enabled, documentVisible, running, composing, conflict, draft, phase, attachmentCount, requestPrediction, isComposerComposing])

      React.useEffect(function () {
        var eligible = enabled && documentVisible && !running && !composing && !conflict
          && isBlankDraft(draft) && phase === 'plain' && attachmentCount === 0
        publishStatus({ canRetry: eligible })
        var retry = function () { if (eligible) requestPrediction('manual', true) }
        retryPrediction = retry
        return function () {
          if (retryPrediction === retry) { retryPrediction = null; publishStatus({ canRetry: false }) }
        }
      }, [sessionId, enabled, documentVisible, running, composing, conflict, draft, phase, attachmentCount, requestPrediction])

      React.useEffect(function () {
        return function () {
          invalidateRequest()
        }
      }, [])

      var visible = enabled
        && documentVisible
        && prediction !== null
        && typeof prediction.text === 'string'
        && prediction.text !== ''
        && prediction.sessionId === sessionId
        && isBlankDraft(draft)
        && phase === 'plain'
        && attachmentCount === 0
        && !composing
        && !running
        && !conflict

      useTabAccept(visible ? prediction : null, draft, phase, attachmentCount, composing, enabled, running, acceptPrediction, dismissPrediction, isComposerComposing, composition.getEditor)
      useGhostPosition(rootRef, visible, prediction?.text)

      React.useEffect(function () {
        if (!visible || prediction === null) return
        var key = sessionId + ':' + (prediction.turnId ?? '') + ':' + prediction.text
        if (shownKeyRef.current === key) return
        shownKeyRef.current = key
        bumpStat('shown')
      }, [visible, prediction, sessionId])

      var anchor = React.createElement('span', { ref: anchorRef, hidden: true, 'data-dshcp-anchor': '' })
      if (!visible) return anchor

      return React.createElement(React.Fragment, null,
        anchor,
        React.createElement('div', {
          ref: rootRef,
          className: 'dshcp-layer',
          'data-dshcp-prediction': '',
          'data-composer-ghost': OWN_ID,
          'data-composer-ghost-priority': '100',
        },
          React.createElement('div', {
            className: 'dshcp-ghost',
            title: prediction.text,
          },
            React.createElement('div', {
              className: 'dshcp-ghost-text',
              'aria-hidden': 'true',
            },
              React.createElement('span', { className: 'dshcp-avoid', 'aria-hidden': 'true' }),
              React.createElement('span', { className: 'dshcp-ghost-content' }),
            ),
            React.createElement('div', {
              className: 'dshcp-actions',
              'aria-busy': regenerating ? 'true' : 'false',
            },
              React.createElement('button', {
                type: 'button',
                className: 'dshcp-action',
                'data-regen': '',
                'aria-label': regenerating ? t('regenerating') : t('regenerate'),
                title: regenerating ? t('regenerating') : t('regenerate'),
                disabled: regenerating,
                onMouseDown: function (event) { event.preventDefault() },
                onClick: regenerate,
              }, regenerating ? '…' : '↻'),
              React.createElement('button', {
                type: 'button',
                className: 'dshcp-action',
                'aria-label': t('hint'),
                title: t('hint'),
                onMouseDown: function (event) { event.preventDefault() },
                onClick: acceptFromAction,
              }, t('hint')),
            ),
          ),
        ),
        React.createElement('div', {
          className: 'dshcp-sr',
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': 'true',
        }, t('a11ySuggestion', { text: prediction.text })),
      )
    }

    function SettingsRow(props) {
      var t = props.t
      var snapshot = useSettingsSnapshot()
      var localStats = useStatsSnapshot()
      var diagnostic = useStatus()
      var pendingState = React.useState(null)
      var pending = pendingState[0]
      var setPending = pendingState[1]
      var baseEnabled = snapshot.value?.enabled !== false
      var enabled = pending !== null ? pending : baseEnabled
      var disabled = snapshot.status !== 'ready' || snapshot.writable === false

      if (snapshot.status === 'unavailable') return null

      function toggle() {
        if (disabled || settingsRef === null) return
        var next = !enabled
        setPending(next)
        settingsRef.set('enabled', next).then(function (accepted) {
          if (accepted !== true) console.warn('[dsh-composer-predictions] settings write was not accepted')
        }).catch(function (error) {
          console.warn('[dsh-composer-predictions] settings write failed', error)
        }).finally(function () {
          setPending(null)
        })
      }

      return React.createElement('div', {
        className: 'dshcp-setting-row',
        'data-dshcp-setting': 'predictions',
      },
        React.createElement('div', { className: 'dshcp-setting-copy' },
          React.createElement('div', { className: 'dshcp-setting-title' }, t('settingTitle')),
          React.createElement('div', {
            className: 'dshcp-setting-desc',
            id: 'dshcp-setting-description',
          }, t('settingDescription')),
          React.createElement('div', { className: 'dshcp-setting-stats' },
            t('stats', {
              shown: localStats.shown,
              accepted: localStats.accepted,
              regenerated: localStats.regenerated,
            }),
            React.createElement('button', {
              type: 'button',
              className: 'dshcp-reset',
              onClick: resetStats,
            }, t('resetStats')),
          ),
          React.createElement('div', { className: 'dshcp-setting-status', role: 'status', 'aria-live': 'polite' },
            t('recentStatus', {
              reason: t('reason.' + (diagnostic.conflict ? 'conflict' : diagnostic.reason), { name: diagnostic.conflict }),
              timing: diagnostic.ms === null ? '' : ' · ' + diagnostic.ms + ' ms',
            }),
            ' ',
            React.createElement('button', {
              type: 'button', className: 'dshcp-reset',
              disabled: !diagnostic.canRetry || diagnostic.reason === 'requesting',
              onClick: function () { retryPrediction?.() },
            }, t('retry')),
          ),
        ),
        React.createElement('button', {
          type: 'button',
          role: 'switch',
          className: 'dshcp-switch',
          'aria-label': t('settingTitle'),
          'aria-describedby': 'dshcp-setting-description',
          'aria-checked': enabled,
          'data-on': enabled ? '' : undefined,
          disabled: disabled,
          onClick: toggle,
        }, React.createElement('span', { className: 'dshcp-switch-thumb' })),
      )
    }

    function apply(ctx) {
      settingsRef = ctx.configForms.get('dsh-composer-predictions')

      ctx.effect(function () {
        var disposed = false, frame = null, active = false, observer = null
        var markers = new Set()
        var markerSelector = '[data-composer-ghost],[data-next-hint-anchor],[data-next-hint-state],[data-next-hint="ghost"]'
        function refresh() {
          if (disposed || !active) return
          var entries = [], ids = []
          try { entries = ctx.slots.entriesOfSlot?.('conversation.input.overlay') || [] } catch {}
          try {
            var modules = ctx.get?.('modules')?.manifest?.modules || []
            ids = modules.map(function (row) { return row.id })
          } catch {}
          var ghosts = [], hint = false
          for (var marker of markers) {
            if (marker.hasAttribute('data-composer-ghost')) ghosts.push(marker)
            if (marker.matches('[data-next-hint-anchor],[data-next-hint-state],[data-next-hint="ghost"]')) hint = true
          }
          var conflict = findConflict(entries, ghosts, ids)
          if (!conflict && hint) conflict = 'dsh-next-hint'
          publishStatus({ conflict: conflict, ...(status.conflict && !conflict && status.reason === 'conflict' ? { reason: 'idle' } : {}) })
        }
        function schedule() {
          if (disposed || !active || frame !== null) return
          frame = setTimeout(function () { frame = null; refresh() }, 0)
        }
        function collect(node) {
          if (node.nodeType !== 1) return false
          var changed = false
          if (node.matches(markerSelector) && !markers.has(node)) { markers.add(node); changed = true }
          // Search only the newly added subtree; never rescan the document for
          // unrelated message text, table rows or process-tree updates.
          for (var child of node.querySelectorAll(markerSelector)) {
            if (!markers.has(child)) { markers.add(child); changed = true }
          }
          return changed
        }
        function onMutations(records) {
          if (!active) return
          var changed = false
          for (var record of records) {
            if (record.type === 'attributes') {
              var target = record.target
              var present = target.matches(markerSelector)
              if (present) { markers.add(target); changed = true }
              else if (markers.delete(target)) changed = true
              continue
            }
            for (var removed of record.removedNodes) {
              if (removed.nodeType !== 1) continue
              for (var known of markers) {
                if (removed === known || removed.contains(known)) { markers.delete(known); changed = true }
              }
            }
            for (var added of record.addedNodes) changed = collect(added) || changed
          }
          if (changed) schedule()
        }
        function updateObservation() {
          var eligible = !disposed && isFeatureEnabled(getSettingsSnapshot()) && isDocumentVisible()
          if (eligible === active) return
          active = eligible
          observer?.disconnect()
          observer = null
          if (frame !== null) { clearTimeout(frame); frame = null }
          markers.clear()
          if (!active) {
            publishStatus({ conflict: '', ...(status.reason === 'conflict' ? { reason: 'idle' } : {}) })
            return
          }
          // One full discovery pass on enable/foreground, followed exclusively
          // by registry notifications and incremental marker changes.
          if (typeof document.querySelectorAll === 'function') {
            for (var node of document.querySelectorAll(markerSelector)) markers.add(node)
          }
          if (typeof MutationObserver !== 'undefined' && document.documentElement) {
            observer = new MutationObserver(onMutations)
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
              attributeFilter: ['data-composer-ghost', 'data-composer-ghost-priority', 'data-next-hint-anchor', 'data-next-hint-state', 'data-next-hint'] })
          }
          refresh()
        }
        var off = ctx.slots.subscribe?.('conversation.input.overlay', schedule)
        var offSettings = subscribeSettings(updateObservation)
        document.addEventListener('visibilitychange', updateObservation)
        updateObservation()
        return function () {
          disposed = true
          if (frame !== null) clearTimeout(frame)
          off?.()
          offSettings()
          document.removeEventListener('visibilitychange', updateObservation)
          observer?.disconnect()
          markers.clear()
          offers.clear()
          retryPrediction = null
        }
      }, 'dsh-composer-predictions: coexistence')

      ctx.effect(function () {
        var tag = injectStyle()
        return function () {
          if (tag !== null) tag.remove()
        }
      }, 'dsh-composer-predictions: styles')

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-composer-predictions: dictionaries')

      ctx.slots.inject('conversation.input.overlay', function () {
        return ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'dsh-composer-predictions',
          order: 20,
          locale: NS,
        }, PredictionOverlay)
      })

      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'dsh-composer-predictions-setting',
          order: 60,
          locale: NS,
        }, SettingsRow)
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'configForms']
    /** Test seam for the pure Tab guard; no runtime behavior depends on it. */
    exports.__test = {
      splitGraphemes: splitGraphemes,
      canAccept: canAccept,
      isBlankDraft: isBlankDraft,
      isFeatureEnabled: isFeatureEnabled,
      closedTurnStamp: closedTurnStamp,
      rememberOffer: rememberOffer,
      readOffer: readOffer,
      findConflict: findConflict,
      clientDeadlineMs: clientDeadlineMs,
    }
    return module.exports
  },
})
