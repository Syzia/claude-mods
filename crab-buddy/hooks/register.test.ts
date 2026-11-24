import { expect, mock, test } from 'claude-code/testing'

const ENV: Record<string, string> = {
  HOME: '/home/me',
  CLAUDE_CODE_HOST_SESSION_ID: 'local_abc-123',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/4242.sock',
}
const HOME = '/home/me/.claude/crab-buddy'
const STATUS = `${HOME}/sessions/chat-1.json`

// Nothing sits beneath the mod in a test, so these hooks stand for the engine:
// they answer every call the mod makes and keep what it writes.
// `seed` is what is on disk already; `thought` is what the model answers.
const engine = (on: any, seed: Record<string, string> = {}, thought = 'It is a crab.') => {
  const files: Record<string, string> = { ...seed }
  const ran: string[][] = []
  const prompts: string[] = []
  // A clock that moves only when the test moves it: it answers `$.clock`.
  const clock = mock.clock(on, { now: 1000 })

  on('env.get', (_: unknown, e: { name: string }) => ({ value: ENV[e.name] }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.cwd', () => ({ value: '/work/my-project' }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path] ?? '4' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_: unknown, e: { path: string }) => ({
    value: Object.keys(files)
      .filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 1000, isLink: false })),
  }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    ran.push(e.argv)

    return { value: { exitCode: 0, stdout: e.argv.includes('--ocr') ? 'EADDRINUSE: port 3000' : '', stderr: '' } }
  })
  on('model.complete', (_: unknown, e: { prompt: string }) => {
    prompts.push(String(e.prompt))

    return { value: { isAnswered: true, text: thought, usage: {} } }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Make login faster', toolUses: [] },
      { role: 'assistant', text: 'Done: the token is fetched on every request.', toolUses: [] },
    ],
  }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))

  return {
    files,
    ran,
    prompts,
    // Two seconds on, the mod looks for asks; a moment later its claim has held.
    look: async () => {
      await clock.advance(2000)
      await clock.advance(300)
    },
    answer: (id: string) => JSON.parse(files[`${HOME}/answers/${id}.json`] ?? 'null'),
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

const asked = (ask: Record<string, unknown>) => ({ [`${HOME}/asks/${ask.id}.json`]: JSON.stringify(ask) })

test('a question about the screen is answered from what is on it', async ($, on) => {
  const { answer, ran, prompts, files, look } = engine(
    on,
    asked({ id: 'q1', kind: 'ask', question: 'What is this error?', screen: true }),
  )

  await start($)
  await look()
  expect(answer('q1')).toMatchObject({ ok: true, text: 'It is a crab.', shot: `${HOME}/shots/q1.jpg` })
  expect(files[`${HOME}/asks/q1.claim`]).toMatch(/^chat-1:/)
  expect(ran).toContainEqual(['/usr/sbin/screencapture', '-x', '-t', 'jpg', `${HOME}/shots/q1.jpg`])
  expect(prompts[0]).toContain('What is this error?')
  expect(prompts[0]).toContain('EADDRINUSE: port 3000')
})

test('a question without the screen takes no picture, and one for another chat is left alone', async ($, on) => {
  const { answer, ran, files, look } = engine(on, {
    ...asked({ id: 'q2', kind: 'ask', question: 'Why is the sky blue?', screen: false }),
    ...asked({ id: 'q3', kind: 'dream', question: '', screen: false, for: 'chat-2' }),
  })

  await start($)
  await look()
  expect(answer('q2')).toMatchObject({ ok: true, text: 'It is a crab.' })
  expect(ran.some(argv => argv[0] === '/usr/sbin/screencapture')).toBe(false)
  expect(answer('q3')).toBeNull()
  expect(files[`${HOME}/asks/q3.claim`]).toBeUndefined()
})

test('a dream is an idea about this chat, and no idea is no answer', async ($, on) => {
  const idea = engine(on, asked({ id: 'd1', kind: 'dream', question: '', screen: false, for: 'chat-1' }), 'Cache the token.')

  await start($)
  await idea.look()
  expect(idea.answer('d1')).toMatchObject({ ok: true, text: 'Cache the token.' })
  expect(idea.prompts[0]).toContain('Person: Make login faster')
})

test('a dream with nothing worth saying is not passed on', async ($, on) => {
  const none = engine(on, asked({ id: 'd2', kind: 'dream', question: '', screen: false, for: 'chat-1' }), 'NONE')

  await start($)
  await none.look()
  expect(none.answer('d2')).toMatchObject({ ok: false })
})
