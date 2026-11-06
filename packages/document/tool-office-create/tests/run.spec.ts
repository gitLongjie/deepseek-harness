import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runOfficeGenerator } from '../src/run.ts'

const pythonHome = fileURLToPath(new URL(
  '../../../../apps/desktop/.desktop-build/targets/win-x64/runtime/primary-runtime/dependencies/python/', import.meta.url))
const python = join(pythonHome, 'python.exe')
const pythonPackages = join(pythonHome, 'Lib', 'site-packages')

describe.skipIf(!existsSync(python))('runOfficeGenerator with the prepared Desktop Python', () => {
  let directory: string
  let inherited: string | undefined
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-office-create-run-'))
    inherited = process.env.PYTHONIOENCODING
    process.env.PYTHONIOENCODING = 'gbk:surrogateescape'
  })
  afterEach(async () => {
    if (inherited === undefined) delete process.env.PYTHONIOENCODING
    else process.env.PYTHONIOENCODING = inherited
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps non-ASCII slide text when the inherited stdin codec is not UTF-8', async () => {
    const output = join(directory, 'GEO服务提案.pptx')
    await runOfficeGenerator({ python, pythonPackages }, 'pptx', output,
      { slides: [{ title: 'GEO 服务提案', bullets: ['生成式引擎优化'] }] }, new AbortController().signal)
    const bytes = await readFile(output)
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
    const probe = spawnSync(python, ['-c', [
      'import sys, zipfile',
      'xml = []',
      'with zipfile.ZipFile(sys.argv[1]) as package:',
      '    xml.extend(package.read(name).decode("utf-8") for name in package.namelist() if name.endswith(".xml"))',
      'text = "\\n".join(xml)',
      'required = ("070D18", "1FD1A6", "微软雅黑")',
      'missing = [item for item in required if item not in text]',
      'sys.exit(0 if not missing else 1)',
    ].join('\n'), output], { encoding: 'utf8' })
    expect(probe.status).toBe(0)
  })
})
