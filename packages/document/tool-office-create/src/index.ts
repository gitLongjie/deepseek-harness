/**
 * Model-facing tools that create new PowerPoint, Word, and Excel files through the
 * bundled Desktop/SDK Office runtime without shell scripting or package installs.
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  installPrimaryRuntime,
  resolvePrimaryRuntime,
  type WorkspaceDependencies,
} from '@deepseek-ai/dsh-tool-workspace-dependencies'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import type {} from '@deepseek-ai/dsh-working-directory'
import { runOfficeGenerator } from './run.ts'
import {
  validateDocxArgs,
  validatePptxArgs,
  validateXlsxArgs,
  type OfficeCreateKind,
} from './validate.ts'

/** Cordis plugin identity. */
export const name = 'tool-office-create'

/** Services used while resolving the Session working directory and writing through fs identity. */
export const inject = ['tools', 'fs', 'workingDirectory', 'systemPrompt', 'agents']

/** Payload location shared with `load_workspace_dependencies`. */
export interface Config {
  /** Payload directory carrying `runtime.json` and `dependencies/`. */
  readonly source: string
  /**
   * Installation directory under the Harness home. When set, the payload is copied there on the
   * first create call; when omitted, the payload is used in place.
   */
  readonly root?: string
}

/** Require an absolute payload source before activation. */
export const Config: z<Config> = z.object({
  source: z.string().min(1).required(),
  root: z.string().min(1),
})

export {
  validateDocxArgs,
  validatePptxArgs,
  validateXlsxArgs,
} from './validate.ts'
export type {
  DocxBlockInput,
  OfficeCreateKind,
  PptxSlideInput,
  XlsxSheetInput,
} from './validate.ts'
export {
  MAX_BULLET_ITEMS,
  MAX_BULLETS_PER_SLIDE,
  MAX_COLS,
  MAX_DOCX_BLOCKS,
  MAX_ROWS,
  MAX_SHEETS,
  MAX_SLIDES,
  MAX_TEXT_CHARS,
} from './limits.ts'

const CREATE_GUIDANCE = 'For a presentation, deck, or slideshow, load the dashi-ppt skill and follow it. '
  + 'That skill is the default PowerPoint workflow. '
  + 'Call create_pptx, create_docx, or create_xlsx only for a plain Office file, or when dashi-ppt is not in the skill catalog. '
  + 'A successful create already declares the file as a deliverable; Desktop may also open it. '
  + 'Do not write your own generator scripts or search for a system Python. '
  + 'Use office-* skills to edit an existing Office file, render pages, recalculate formulas, or export PDF.'

/**
 * Register the three create tools against the bundled Office runtime.
 * @param ctx - Agent-scoped tool and filesystem services.
 * @param config - Primary-runtime source and optional install root.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.source) || (config.root !== undefined && !isAbsolute(config.root))) {
    throw new Error('office create tools: source and root must be absolute paths')
  }

  let preparation: Promise<WorkspaceDependencies> | undefined
  ctx.effect(() => async () => {
    await preparation?.catch(() => undefined)
  })

  const prepareRuntime = (): Promise<WorkspaceDependencies> => {
    preparation ??= (config.root === undefined
      ? resolvePrimaryRuntime(config.source)
      : installPrimaryRuntime(config.source, config.root))
      .catch((error: unknown) => {
        preparation = undefined
        throw error
      })
    return preparation
  }

  const pending = new WeakMap<ToolExecution, { session: Session; turn: number; path: string; kind: OfficeCreateKind }>()
  ctx.on('tools/result', (exec, result) => {
    const delivery = pending.get(exec)
    pending.delete(exec)
    if (delivery === undefined || result.isError) return
    const label = delivery.kind === 'pptx' ? 'PowerPoint presentation'
      : delivery.kind === 'docx' ? 'Word document' : 'Excel workbook'
    delivery.session.append('deliverables/presented', {
      turn: delivery.turn,
      callId: exec.callId,
      files: [{ path: delivery.path, description: `Created ${label}` }],
    })
  })

  ctx.systemPrompt.section({
    name: 'tool:office-create',
    order: ctx.systemPrompt.getSectionOrder('TOOL_OFFICE_CREATE'),
    text: ({ scope }) => ctx.tools.get('create_pptx', scope) === undefined ? '' : CREATE_GUIDANCE,
  })

  registerCreateTool(ctx, {
    name: 'create_pptx',
    kind: 'pptx',
    description: 'Create a plain PowerPoint presentation (.pptx) with the bundled Office runtime and its built-in 16:9 theme. '
      + 'For a designed deck, load dashi-ppt instead. Use this tool only when that skill is unavailable or the user wants a plain file. '
      + 'A successful create declares the file as a deliverable. Edit existing PPTX files through the office-pptx skill.',
    pending,
    parameters: {
      path: {
        type: 'string', required: true,
        description: 'Destination .pptx path. Relative paths use the Session working directory.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Replace an existing file at path. Defaults to false.',
      },
      slides: {
        type: 'array', required: true,
        description: 'Slides in order. Prefer concise titles and short bullet lists.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'Slide title.' },
            bullets: {
              type: 'array',
              description: 'Optional bullet lines for the slide body.',
              items: { type: 'string' },
            },
            notes: { type: 'string', description: 'Optional speaker notes.' },
          },
        },
      },
    },
    validate: validatePptxArgs,
    payload: value => ({ slides: value.slides }),
    prepareRuntime,
  })

  registerCreateTool(ctx, {
    name: 'create_docx',
    kind: 'docx',
    description: 'Create a new Word document (.docx) with the bundled Office runtime. '
      + 'Use for new documents only. Do not install packages or write Python scripts. '
      + 'A successful create declares the file as a deliverable. Edit existing DOCX files through the office-docx skill.',
    pending,
    parameters: {
      path: {
        type: 'string', required: true,
        description: 'Destination .docx path. Relative paths use the Session working directory.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Replace an existing file at path. Defaults to false.',
      },
      blocks: {
        type: 'array', required: true,
        description: 'Document blocks in reading order: heading, paragraph, or bullet_list.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            type: {
              type: 'string', required: true,
              enum: ['heading', 'paragraph', 'bullet_list'],
              description: 'Block kind.',
            },
            text: { type: 'string', description: 'Text for heading or paragraph blocks.' },
            level: { type: 'integer', description: 'Heading level from 1 to 9. Defaults to 1.' },
            items: {
              type: 'array',
              description: 'Bullet strings when type is bullet_list.',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    validate: validateDocxArgs,
    payload: value => ({ blocks: value.blocks }),
    prepareRuntime,
  })

  registerCreateTool(ctx, {
    name: 'create_xlsx',
    kind: 'xlsx',
    description: 'Create a new Excel workbook (.xlsx) with the bundled Office runtime. '
      + 'Use for new workbooks only. Do not install packages or write Python scripts. '
      + 'A successful create declares the file as a deliverable. Edit existing XLSX files through the office-xlsx skill.',
    pending,
    parameters: {
      path: {
        type: 'string', required: true,
        description: 'Destination .xlsx path. Relative paths use the Session working directory.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Replace an existing file at path. Defaults to false.',
      },
      sheets: {
        type: 'array', required: true,
        description: 'Worksheets with optional dense row values.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Worksheet name (max 31 characters).' },
            rows: {
              type: 'array',
              description: 'Row-major cell values. Omit or use null for empty cells.',
              items: {
                type: 'array',
                items: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        },
      },
    },
    validate: validateXlsxArgs,
    payload: value => ({ sheets: value.sheets }),
    prepareRuntime,
  })
}

interface CreateToolSpec<TArgs, TNormalized extends { path: string; overwrite: boolean }> {
  readonly name: string
  readonly kind: OfficeCreateKind
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly validate: (args: TArgs) => TNormalized
  readonly payload: (value: TNormalized) => unknown
  readonly prepareRuntime: () => Promise<WorkspaceDependencies>
  readonly pending: WeakMap<ToolExecution, { session: Session; turn: number; path: string; kind: OfficeCreateKind }>
}

function registerCreateTool<TArgs, TNormalized extends { path: string; overwrite: boolean }>(
  ctx: Context,
  spec: CreateToolSpec<TArgs, TNormalized>,
): void {
  ctx.tools.register(defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters as never,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Created ${value.path} (${String(value.bytes)} bytes)` }],
    },
    presentCall: args => ({
      card: 'generic',
      title: spec.name,
      locations: [{ path: String((args as { path?: unknown }).path ?? '') }],
    }),
    async execute(args, exec: ToolExecution) {
      if (exec.agent === undefined) throw new Error(`${spec.name} requires an agent Session`)
      const boundary = ctx.agents.turnBoundaryOf(exec.agent.session)
      if (boundary.openTurnStartSeq === null) throw new Error(`${spec.name} requires an open turn`)
      const normalized = spec.validate(args as TArgs)
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const target = await ctx.fs.resolve(normalized.path, { cwd, signal: exec.signal })
      const existing = await ctx.fs.stat(target, exec.signal)
      if (existing !== undefined) {
        if (existing.type !== 'file') throw new Error(`Cannot create ${normalized.path}: path exists and is not a file`)
        if (!normalized.overwrite) {
          throw new Error(`Cannot create ${normalized.path}: file exists (pass overwrite: true to replace it)`)
        }
      }
      let runtime: WorkspaceDependencies
      try {
        runtime = await spec.prepareRuntime()
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`bundled Office runtime unavailable: ${detail}. Do not install packages; report this Host runtime failure.`)
      }
      const outputPath = ctx.fs.processPath(target)
      // Claim the destination through workspace-changes before the generator writes
      // outside `fs.write*`, so a peer Session sharing this working tree does not
      // attribute the new Office file to its own turn's git summary.
      await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      await runOfficeGenerator(runtime, spec.kind, outputPath, spec.payload(normalized), exec.signal)
      const created = await ctx.fs.stat(target, exec.signal)
      if (created === undefined || created.type !== 'file' || created.size === undefined) {
        throw new Error(`${spec.name} did not produce a regular file at ${normalized.path}`)
      }
      const header = await ctx.fs.readBytes(target, exec.signal, 4)
      if (header.length < 4 || header[0] !== 0x50 || header[1] !== 0x4b) {
        throw new Error(`${spec.name} produced a file that is not a valid Office Open XML package`)
      }
      spec.pending.set(exec, {
        session: exec.agent.session,
        turn: boundary.lastTurn,
        path: outputPath,
        kind: spec.kind,
      })
      return { path: outputPath, bytes: created.size }
    },
  }))
}
