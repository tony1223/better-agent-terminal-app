/**
 * The worker helpers have to agree with the desktop byte for byte: the log
 * buffer is shared between a desktop window and this phone, and the composite
 * pty id is how output is routed on both. These pin the ported rules.
 */

import {
  WORKER_COLORS,
  buildWorkerHeader,
  deriveWorkerActivity,
  isProcfileName,
  parseWorkerBuffer,
  prefixWorkerChunk,
  procfileBasename,
  procfileDirectory,
  serializeWorkerEntries,
  splitWorkerPtyId,
  workerLinePrefix,
  workerPtyId,
  worktreeProcessEnv,
  type WorkerProcess,
} from '../src/utils/worker'

describe('composite pty id', () => {
  it('round-trips panel and process name', () => {
    expect(splitWorkerPtyId(workerPtyId('panel-1', 'web'))).toEqual({ panelId: 'panel-1', name: 'web' })
  })

  it('does not mistake an ordinary terminal id for worker output', () => {
    expect(splitWorkerPtyId('terminal-1')).toBeNull()
    expect(splitWorkerPtyId('__w__web')).toBeNull()
    expect(splitWorkerPtyId('panel__w__')).toBeNull()
  })
})

describe('Procfile discovery', () => {
  it('matches the desktop pattern', () => {
    expect(isProcfileName('Procfile')).toBe(true)
    expect(isProcfileName('Procfile.dev')).toBe(true)
    expect(isProcfileName('procfile')).toBe(true)
    expect(isProcfileName('MyProcfile')).toBe(false)
    expect(isProcfileName('Procfile-old')).toBe(false)
  })

  it('takes the basename of a Windows path too', () => {
    expect(procfileBasename('C:\\repo\\Procfile.dev')).toBe('Procfile.dev')
    expect(procfileBasename('/home/u/repo/Procfile')).toBe('Procfile')
  })

  it('runs processes from the Procfile directory', () => {
    expect(procfileDirectory('C:\\repo\\app\\Procfile', 'fallback')).toBe('C:\\repo\\app')
    expect(procfileDirectory('/repo/Procfile', 'fallback')).toBe('/repo')
    expect(procfileDirectory('Procfile', 'fallback')).toBe('fallback')
  })
})

describe('log buffer', () => {
  it('parses NDJSON and skips torn lines', () => {
    const raw = '{"name":"web","color":"","data":"hi\\n"}\n{"name":"__header__","color":"","data":"H"}\n{"name":"web"\n'
    expect(parseWorkerBuffer(raw)).toEqual([
      { name: 'web', color: '', data: 'hi\n' },
      { name: '__header__', color: '', data: 'H' },
    ])
  })

  it('serialises the way the desktop reads', () => {
    const entries = [{ name: 'web', color: '#61afef', data: 'x' }]
    expect(parseWorkerBuffer(serializeWorkerEntries(entries))).toEqual(entries)
    expect(serializeWorkerEntries(entries).endsWith('\n')).toBe(true)
  })

  it('returns nothing for an empty buffer', () => {
    expect(parseWorkerBuffer('')).toEqual([])
    expect(parseWorkerBuffer('  \n')).toEqual([])
  })
})

describe('prefixWorkerChunk', () => {
  const P = '<web> '

  it('prefixes every line start and reports whether it ended mid-line', () => {
    expect(prefixWorkerChunk('a\nb', P, false)).toEqual({ output: '<web> a\n<web> b', midLine: true })
    expect(prefixWorkerChunk('a\n', P, false)).toEqual({ output: '<web> a\n', midLine: false })
  })

  it('continues a line the previous chunk left open', () => {
    expect(prefixWorkerChunk('tail\n', P, true)).toEqual({ output: 'tail\n', midLine: false })
  })

  it('keeps CRLF whole and re-prefixes after a bare carriage return', () => {
    expect(prefixWorkerChunk('a\r\nb', P, false).output).toBe('<web> a\r\n<web> b')
    expect(prefixWorkerChunk('50%\r100%', P, false).output).toBe('<web> 50%\r<web> 100%')
  })
})

describe('rendering', () => {
  it('pads the name and paints it in true colour', () => {
    expect(workerLinePrefix('web', '#61afef', 5)).toBe('\x1b[38;2;97;175;239mweb  \x1b[0m\x1b[90m | \x1b[0m')
  })

  it('builds the same header banner as the desktop', () => {
    const header = buildWorkerHeader('/repo/Procfile', 2)
    expect(header).toContain('Worker: Procfile (2 processes)\r\n')
    expect(header).toContain('─'.repeat(60))
  })

  it('assigns worktree env from the cwd', () => {
    expect(worktreeProcessEnv('/repo/.bat-worktrees/0a1b2c3d4e/app')).toEqual({
      BAT_WORKTREE_ID: '0a1b2c3d4e',
      BAT_WORKTREE_INDEX: String(parseInt('0a1b2c', 16) % 100),
      BAT_PORT_OFFSET: String((parseInt('0a1b2c', 16) % 100) * 10),
    })
    expect(worktreeProcessEnv('/repo/app')).toEqual({})
  })
})

describe('deriveWorkerActivity', () => {
  const proc = (status: WorkerProcess['status']): WorkerProcess =>
    ({ name: 'p', command: 'c', ptyId: 'x__w__p', color: WORKER_COLORS[0], status })

  it('is alive while any process is up, stopped when none is', () => {
    expect(deriveWorkerActivity([proc('running'), proc('crashed')])).toBe('idle')
    expect(deriveWorkerActivity([proc('starting')])).toBe('idle')
    expect(deriveWorkerActivity([proc('stopped'), proc('crashed')])).toBe('stopped')
    expect(deriveWorkerActivity([])).toBe('stopped')
  })

  it('does not call a panel stopped before its roster has been read', () => {
    expect(deriveWorkerActivity(undefined)).toBe('idle')
  })
})
