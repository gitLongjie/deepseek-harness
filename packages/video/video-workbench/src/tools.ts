/** Agent-scoped tools over the host's shared authoring store. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import { studioContent, studioId, StudioError } from './studio-store.ts'

/** Agent-plane entry; the workbench owner remains on the host. */
export const name = 'tool-video-studio'
/** Required services are resolved before tool registration. */
export const inject = ['tools', 'videoWorkbenchStudio'] as const

/** Register read and revision-checked authoring tools.
 * @param ctx - agent-scoped registry and host-owned studio store.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'video_studio_read',
    description: 'Read the production workbench catalog, or a complete saved work by id. The returned JSON contains its revision and authoring content. Read before editing; retain every unrelated content field when saving. Works are separate from video generation plans.',
    parameters: { id: { type: 'string', description: 'Work UUID; omit to list works.' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const value = args.id === undefined ? await ctx.videoWorkbenchStudio.list() : await ctx.videoWorkbenchStudio.read(studioId(args.id))
      return JSON.stringify(value)
    },
    presentCall: args => ({ card: 'generic', title: 'Read production work', kind: 'read', rawInput: args.id ?? '' }),
  }))
  ctx.tools.register(defineTool({
    name: 'video_studio_export',
    description: 'Export a saved work revision as a local MP4 with video layers, mixed audio and selectable subtitles. Media source paths must be relative to the controlled video output directory. Later video tracks cover earlier tracks. Requires local FFmpeg/FFprobe; does not call paid generation services. Read and save the work before export. A work cannot run two exports concurrently.',
    parameters: {
      id: { type: 'string', required: true }, revision: { type: 'integer', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, revision: { type: 'integer', required: true },
        duration: { type: 'number', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return ctx.videoWorkbenchStudio.export(studioId(args.id), args.revision, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Export production movie', rawInput: args.id }),
  }))
  ctx.tools.register(defineTool({
    name: 'video_studio_save',
    description: 'Create or revise a production work. content_json is a JSON object with title, source and blocks, optionally canvas, graph, director and edit. Blocks: {id:UUID,kind:scene|action|character|dialogue|parenthetical|transition,text}. Canvas cards: {id,kind:scene|asset|note,title,text,x,y}. Graph: {nodes:[{id,label,kind:character|place|event|asset}],edges:[{id,from,to,label}]}. Director: [{id,name,camera,objects:[{id,label,x,y,z}],viewpoint?:{x,y,z,fov}}]. Edit: {tracks:[{id,kind:video|dialogue|sfx|music|subtitle,name,clips:[{id,name,start,duration,source?,sourceStart?,volume?}]}]}; times are seconds. Reuse stable UUIDs. For revisions, read first and supply id plus revision; preserve all unrelated fields. Omit format/version/id/revision/updatedAt from content_json. This stores the project only, without generating or exporting media. A conflict requires rereading; never blindly retry with a newer revision.',
    parameters: {
      id: { type: 'string', description: 'Work UUID for editing; omit together with revision to create.' },
      revision: { type: 'integer', description: 'Revision returned by video_studio_read.' },
      content_json: { type: 'string', required: true, description: 'Complete authored content as JSON, excluding revision metadata.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string', required: true }, revision: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if ((args.id === undefined) !== (args.revision === undefined)) throw new StudioError('invalid', 'Provide id and revision together')
      let input: unknown
      try { input = JSON.parse(args.content_json) } catch (error) {
        if (error instanceof SyntaxError) throw new StudioError('invalid', 'content_json must be valid JSON')
        throw error
      }
      const content = studioContent(input)
      const doc = args.id === undefined || args.revision === undefined
        ? await ctx.videoWorkbenchStudio.create(content)
        : await ctx.videoWorkbenchStudio.save(studioId(args.id), args.revision, content)
      return { id: doc.id, revision: doc.revision }
    },
    presentCall: args => ({ card: 'generic', title: 'Save production work', rawInput: args.content_json }),
  }))
}
