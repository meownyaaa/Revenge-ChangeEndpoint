import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'build', 'dist')
mkdirSync(dist, { recursive: true })

const only = process.argv[2]
for (const name of readdirSync(join(root, 'plugins'))) {
	if (only && name !== only) continue
	const dir = join(root, 'plugins', name)
	const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
	const script = manifest.dist?.script
	const zip = join(dist, `${manifest.id}@${manifest.version}.zip`)
	rmSync(zip, { force: true })

	const files = ['manifest.json']
	const args = ['-a', '-cf', zip, '-C', dir, 'manifest.json']
	if (script) {
		const js = join(dir, 'build', 'js')
		if (!existsSync(join(js, 'index.js'))) throw new Error(`${name}: run the JS build first`)
		if (script !== 'index.js') throw new Error(`${name}: dist.script must be index.js`)
		args.push('-C', js, 'index.js')
		files.push('index.js')
	}
	const android = manifest.dist?.android
	if (android) {
		const jar = join(dir, 'build', 'outputs', 'plugin')
		if (!existsSync(join(jar, 'plugin.jar'))) throw new Error(`${name}: run the dexJar task first`)
		if (android.path !== 'plugin.jar') throw new Error(`${name}: dist.android.path must be plugin.jar`)
		args.push('-C', jar, 'plugin.jar')
		files.push('plugin.jar')
	}
	if (existsSync(join(dir, 'assets'))) {
		args.push('-C', dir, 'assets')
		files.push('assets/')
	}

	execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), args)
	console.log(`Packaged ${manifest.id} (${files.join(', ')})`)
}
