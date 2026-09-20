import { handleRouteRequest } from './routing-protocol'
import type { RouteReply, RouteRequest } from './routing-protocol'

self.addEventListener('message', (event: MessageEvent<RouteRequest>) => {
  handleRouteRequest(event.data, (reply: RouteReply) => self.postMessage(reply))
})
