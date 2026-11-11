import { EventEmitter } from 'events'
class EngineEvents extends EventEmitter {}

export const events = new EngineEvents()
events.setMaxListeners(50)
