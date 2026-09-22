/**
 * QQ's registration in the chat-channel id map.
 *
 * Types only. The map is merge-extensible, so this provider adds its own key
 * from its own module and no seam Definition changes when a platform appears.
 *
 * @module @deepseek-ai/dsh-channel-qq/types
 */

// Import the module so the declaration below augments its map rather than
// defining an unrelated ambient module.
import type {} from '@deepseek-ai/dsh-channel/types'

declare module '@deepseek-ai/dsh-channel/types' {
  interface ChatChannelIdMap {
    /** QQ (QQ 机器人开放平台). */
    qq: 'qq'
  }
}
