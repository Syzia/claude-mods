// A test helper (never installed): /sl-e2e <tool name> <json arguments> makes one tool call through the engine's own
// tool pipeline, the way the model would, and prints what came back. It needs no model. A fake MCP server connects in
// the background, so a call that finds no such tool yet is tried again (for up to 20 s) before it is given up.
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sl-e2e', description: 'test helper', argumentHint: '<tool> <json>' })
    return next(e)
  })

  on('command.run', { command: 'sl-e2e' }, async ($, e) => {
    const text = e.args.trim()
    const space = text.indexOf(' ')
    const tool = space < 0 ? text : text.slice(0, space)
    const json = space < 0 ? '' : text.slice(space + 1).trim()
    let args: Record<string, unknown> = {}
    try {
      args = json === '' ? {} : (JSON.parse(json) as Record<string, unknown>)
    } catch {
      return { text: 'E2E bad json' }
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await $.tool.call({ ...args, tool } as never)
        return { text: 'E2E ' + JSON.stringify(result) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/no tool named/.test(message) || attempt >= 40) return { text: 'E2E threw: ' + message }
        await new Promise<void>(resolve => {
          $.clock.after(500, () => resolve())
        })
      }
    }
  })
}
