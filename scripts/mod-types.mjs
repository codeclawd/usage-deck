// Lays out the mods API types that plugins/usage-deck/tsconfig.json extends, so tsc runs in a clean clone.
//
// Claude Code writes plugins/usage-deck/.claude-plugin/types/ (gitignored) for the version you run, but only
// when it loads the mod with --plugin-dir in an interactive, signed-in session. A fresh clone and CI have no
// such session, so this script fetches the copy Anthropic publishes (anthropics/claude-code,
// mods/types/claude-code.d.ts) at a pinned commit, checks its sha256, and writes it where Claude Code would,
// with a tsconfig.json beside it. A folder Claude Code wrote is left alone, so a local typecheck uses the
// types of the version you run.
//
// To move the pin: set COMMIT to a newer anthropics/claude-code commit and SHA256 to the file's hash there.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMIT = 'e2c963a886e345ca22d5e882ff8a63e3192529d0'
const SHA256 = '5dba5fe27a0f2161df65bbc46fcfa62138b5db4db928ec3965179345e78b771b'
const SOURCE = `https://raw.githubusercontent.com/anthropics/claude-code/${COMMIT}/mods/types/claude-code.d.ts`
const TAG = '// usage-deck pinned types:'
const MARK = `${TAG} anthropics/claude-code@${COMMIT} mods/types/claude-code.d.ts`

// The compiler options of anthropics/claude-code's own mods/tsconfig.json at COMMIT. Paths are relative to
// this generated file: the declarations beside it, and the plugin's hooks/ and types/.
const TSCONFIG = {
  compilerOptions: {
    target: 'es2023',
    lib: ['es2023'],
    types: [],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: 'react',
    jsxFactory: 'h',
    jsxFragmentFactory: 'Fragment',
  },
  include: ['./**/*.d.ts', '../../hooks', '../../types'],
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '../plugins/usage-deck/.claude-plugin/types')
const dts = join(dir, 'claude-code/index.d.ts')
const first = existsSync(dts) ? readFileSync(dts, 'utf8').split('\n', 1)[0] : null

if (first !== null && !first.startsWith(TAG)) {
  console.log(`mod-types: keeping the types Claude Code wrote (${first})`)
} else {
  if (first !== MARK) {
    const res = await fetch(SOURCE)
    if (!res.ok) throw new Error(`mod-types: ${SOURCE}: HTTP ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    const got = createHash('sha256').update(body).digest('hex')
    if (got !== SHA256) throw new Error(`mod-types: ${SOURCE}: sha256 ${got}, expected ${SHA256}`)
    mkdirSync(dirname(dts), { recursive: true })
    writeFileSync(dts, `${MARK}\n${body}`)
  }
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`)
  console.log(`mod-types: ${MARK.slice(TAG.length + 1)}`)
}
