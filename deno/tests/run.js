import process from 'https://deno.land/std@0.132.0/node/process.ts'
import { existsSync } from 'https://deno.land/std@0.132.0/node/fs.ts'
import path from 'https://deno.land/std@0.132.0/node/path.ts'
import { spawn } from 'https://deno.land/std@0.132.0/node/child_process.ts'
import { fileURLToPath } from 'https://deno.land/std@0.132.0/node/url.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv.slice(2).join(' ')

if (!command)
  throw new Error('Missing command to run')

const env = { ...process.env }
const localBin = path.join(root, '.test-bin')

if (existsSync(localBin)) {
  const nextPath = localBin + path.delimiter + (env.PATH || env.Path || '')
  env.PATH = nextPath
  env.Path = nextPath
  env.PGHOST || (env.PGHOST = 'localhost')
  env.PGPORT || (env.PGPORT = '5432')
  env.PGUSER || (env.PGUSER = 'postgres')
  env.PGDATABASE || (env.PGDATABASE = 'postgres')
  env.PGSOCKET || (env.PGSOCKET = 'localhost')
}

const child = spawn(command, {
  cwd: root,
  env,
  shell: true,
  stdio: 'inherit'
})

child.on('exit', code => process.exit(code ?? 1))
child.on('error', error => {
  console.error(error)
  process.exit(1)
})