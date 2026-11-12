import { expect, test } from 'claude-code/testing'

const ENV: Record<string, string> = {
  HOME: '/home/me',
  CLAUDE_CODE_HOST_SESSION_ID: 'local_abc-123',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/4242.sock',
}
const STATUS = '/home/me/.claude/crab-buddy/sessions/chat-1.json'

// Nothing sits beneath the mod in a test, so these hooks stand for the engine:
// they answer every call the mod makes and keep what it writes.
const engine = (on: any) => {
  const files: Record<string, string> = {}
  const ran: string[][] = []

  on('env.get', (_: unknown, e: { name: string }) => ({ value: ENV[e.name] }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.cwd', () => ({ value: '/work/my-project' }))
  on('clock.now', () => ({ value: 1000 }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.read', () => ({ value: '4' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    ran.push(e.argv)

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))

  return {
    files,
    ran,
    status: () => JSON.parse(files[STATUS] ?? '{}'),
  }
}

const start = ($: any) =>
  $.session.start({ cwd: '/work/my-project', surface: 'desktop', isInteractive: true })

const prompt = ($: any, text: string) => $.turn.start({ text, turnId: 't1' })

// As the person typing the command: the test leaves out where it was typed.
const command = ($: any, name: string) => $.command.run({ command: name, args: '' })

const finish = ($: any, reason: string) =>
  $.turn.complete({
    answer: '',
    durationMs: 10,
    isAborted: reason === 'aborted',
    turnId: 't1',
    reason,
  })

test('a turn is shown working, then done, under the chat it belongs to', async ($, on) => {
  const { status, ran } = engine(on)
  on('tool.call', () => {
    expect(status()).toMatchObject({ state: 'running', label: 'Running a command' })

    return { result: {} }
  })

  await start($)

  await prompt($, '  Fix the\n  login   bug ')
  expect(status()).toMatchObject({
    state: 'running',
    label: 'Thinking…',
    title: 'Fix the login bug',
    folder: 'my-project',
    host: 'local_abc-123',
    pid: 4242,
  })

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(status()).toMatchObject({ state: 'running', label: 'Thinking…' })

  await finish($, 'answer')
  expect(status()).toMatchObject({ state: 'done' })
  // the session's start put the crab on the desktop, without holding the start up
  expect(ran).toContainEqual(['/usr/bin/open', '-g', '/home/me/.claude/crab-buddy/Crab Buddy.app'])
})

test('a turn the person stopped or that failed is not shown as done', async ($, on) => {
  const { status } = engine(on)

  await start($)
  await prompt($, 'go')
  await finish($, 'aborted')
  expect(status()).toMatchObject({ state: 'stopped' })

  await prompt($, 'again')
  await finish($, 'error')
  expect(status()).toMatchObject({ state: 'failed', label: 'Hit an error' })
})

test('a question or a permission prompt is a wait for the person', async ($, on) => {
  const { status } = engine(on)
  const during: Record<string, unknown>[] = []
  on('tool.call', () => {
    during.push(status())

    return { result: {} }
  })

  await start($)
  await prompt($, 'go')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  expect(during[0]).toMatchObject({ state: 'waiting', kind: 'question', label: 'Has a question' })
  expect(status()).toMatchObject({ state: 'running' })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect(status()).toMatchObject({ state: 'waiting', kind: 'permission', label: 'Needs your OK' })
})

test('/crab-away quiets the chat and /crab brings the crab back', async ($, on) => {
  const { status, files, ran } = engine(on)

  await start($)
  await command($, 'crab-away')
  expect(status()).toMatchObject({ state: 'away' })
  expect(ran).toContainEqual(['/usr/bin/pkill', '-x', 'CrabBuddy'])

  await prompt($, 'still quiet')
  expect(status()).toMatchObject({ state: 'away' })

  await command($, 'crab')
  expect(status()).toMatchObject({ state: 'idle' })
  expect(files['/home/me/.claude/crab-buddy/show']).toBe('')
})
