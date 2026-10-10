import { DevToolsClient } from '@revenge-mod/devtools-client'

let client: DevToolsClient | undefined

export default plugin({
	preInit() {
		client = new DevToolsClient()
		client.connect('ws://localhost:7864', 'Revenge Next')
		client.expose('revenge', revenge)
	},
	stop() {
		client?.ws?.close()
		client = undefined
	},
})
