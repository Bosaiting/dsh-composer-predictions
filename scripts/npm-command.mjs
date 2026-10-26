import { execFileSync } from 'node:child_process'

// npm sets npm_execpath for scripts, avoiding npm.cmd shell quoting on Windows.
export function npm(args, options = {}) {
  const entry = process.env.npm_execpath
  return entry
    ? execFileSync(process.execPath, [entry, ...args], options)
    : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      shell: process.platform === 'win32', ...options,
    })
}
