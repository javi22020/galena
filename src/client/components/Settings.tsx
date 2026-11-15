import { useState, type FormEvent, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { codeFonts, textFonts } from '../../shared/fonts'
import type { Settings as SettingsData } from '../../shared/types'
import { saveSettings, useStore } from '../store'
import { ConfirmDialog, type Confirmation } from './ConfirmDialog'
import { Modal } from './Modal'

/** Agents, Git and editor preferences. */
export function Settings() {
  return (
    <Modal name="settings" title="Settings" className="sm:max-w-3xl">
      <SettingsBody />
    </Modal>
  )
}

function SettingsBody() {
  const settings = useStore((s) => s.settings)
  const registry = useStore((s) => s.agents)
  const sessions = useStore((s) => s.sessions)
  const [filter, setFilter] = useState('')
  const [custom, setCustom] = useState({ id: '', command: '' })
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  // Bumped when the dialog closes, so that a command left unsaved goes back to the saved one.
  const [revision, setRevision] = useState(0)
  const update = (patch: Partial<SettingsData>) => void saveSettings({ ...settings, ...patch })
  const setFonts = (patch: Partial<SettingsData['editor']['fonts']>) =>
    update({ editor: { ...settings.editor, fonts: { ...settings.editor.fonts, ...patch } } })

  const setAgent = (id: string, agent: { command?: string } | null) => {
    const { [id]: _removed, ...agents } = settings.agents
    update({ agents: agent ? { ...agents, [id]: agent } : agents })
  }

  // A new command restarts the agent at once, stopping its running chats, so ask first.
  const setCommand = (id: string, command: string) => {
    const running = sessions.filter((s) => s.agentId === id && s.status === 'running').length
    const changed = id in settings.agents && (command.trim() || undefined) !== settings.agents[id]?.command
    if (!running || !changed) return setAgent(id, { command })
    const chats = running === 1 ? 'the chat' : `the ${running} chats`
    setConfirmation({
      title: `Restart ${registry.find((agent) => agent.id === id)?.name ?? id}?`,
      description: `The new command restarts it now, which stops ${chats} it is working in.`,
      action: 'Restart',
      run: () => setAgent(id, { command }),
    })
  }

  const addCustom = (event: FormEvent) => {
    event.preventDefault()
    if (!custom.id.trim() || !custom.command.trim()) return
    setCommand(custom.id.trim(), custom.command)
    setCustom({ id: '', command: '' })
  }

  // Enabled agents first; ones that are not in the registry are custom.
  const known = new Set(registry.map((agent) => agent.id))
  const customAgents = Object.keys(settings.agents).filter((id) => !known.has(id))
  const wanted = filter.trim().toLowerCase()
  const listed = registry
    .filter((agent) => !wanted || `${agent.name} ${agent.description}`.toLowerCase().includes(wanted))
    .sort((a, b) => Number(b.id in settings.agents) - Number(a.id in settings.agents))

  return (
    <div className="flex min-h-0 flex-col gap-8 overflow-y-auto p-4 pb-6 [&>*]:shrink-0">
      <Section
        title="Agents"
        description="Enabled agents appear in the chat panel. They come from the ACP registry and are run with npx or uvx; each one uses the login or API key of its own CLI."
      >
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${registry.length} agents…`}
        />
        <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border bg-card">
          {customAgents.map((id) => (
            <li key={id} className="flex flex-col gap-2 px-3 py-2.5">
              <label className="flex items-center gap-2.5">
                <Switch checked onCheckedChange={() => setAgent(id, null)} />
                <span className="font-medium">{id}</span>
                <Badge variant="secondary">custom</Badge>
              </label>
              <CommandInput
                key={revision}
                value={settings.agents[id]?.command}
                onCommit={(command) => setCommand(id, command)}
              />
            </li>
          ))}
          {listed.map((agent) => {
            const enabled = settings.agents[agent.id]
            return (
              <li key={agent.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                <label className="flex items-center gap-2.5">
                  <Switch checked={!!enabled} onCheckedChange={(checked) => setAgent(agent.id, checked ? {} : null)} />
                  <span className="font-medium">{agent.name}</span>
                  <span className="text-xs text-muted-foreground">v{agent.version}</span>
                  <Badge variant="secondary">{agent.launch === 'manual' ? 'manual install' : agent.launch}</Badge>
                </label>
                <p className="text-[13px] text-muted-foreground">
                  {agent.description}{' '}
                  {agent.website && (
                    <a
                      href={agent.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline decoration-1 underline-offset-3"
                    >
                      {agent.launch === 'manual' ? 'Install instructions' : 'Website'}
                    </a>
                  )}
                </p>
                {enabled && (
                  <CommandInput
                    key={revision}
                    value={enabled.command}
                    placeholder={
                      agent.launch === 'manual'
                        ? 'Launch command (required), e.g. my-agent acp'
                        : 'Custom launch command (optional)'
                    }
                    onCommit={(command) => setCommand(agent.id, command)}
                  />
                )}
              </li>
            )
          })}
        </ul>
        <form className="flex flex-wrap gap-2" onSubmit={addCustom}>
          <Input
            className="w-full sm:w-48"
            value={custom.id}
            onChange={(e) => setCustom({ ...custom, id: e.target.value })}
            placeholder="Custom agent name"
          />
          <Input
            className="min-w-0 flex-1 font-mono"
            value={custom.command}
            onChange={(e) => setCustom({ ...custom, command: e.target.value })}
            placeholder="Command that starts it in ACP mode"
            spellCheck={false}
          />
          <Button variant="outline">Add</Button>
        </form>
      </Section>

      <Section
        title="Git"
        description="Vaults that are Git repositories are committed and synced from the Git tab, with the Git installed on this machine and its credentials."
      >
        <Field label="Keep Galena's own data (.galena) out of the repository">
          <Switch
            checked={settings.git.excludeGalena}
            onCheckedChange={(excludeGalena) => update({ git: { ...settings.git, excludeGalena } })}
          />
        </Field>
        <Field label="Use the repository this vault is a folder of">
          <Switch
            checked={settings.git.parentRepo}
            onCheckedChange={(parentRepo) => update({ git: { ...settings.git, parentRepo } })}
          />
        </Field>
      </Section>

      <Section title="Editor">
        <Field label="Font size">
          <span className="w-9 text-right font-mono text-xs text-muted-foreground">
            {settings.editor.fontSize}px
          </span>
          <Slider
            aria-label="Font size"
            className="w-40"
            min={12}
            max={24}
            value={[settings.editor.fontSize]}
            onValueChange={([fontSize]) => update({ editor: { ...settings.editor, fontSize: fontSize! } })}
          />
        </Field>
        <Field label="Heading font">
          <FontSelect
            fonts={textFonts}
            value={settings.editor.fonts.heading}
            onChange={(heading) => setFonts({ heading })}
          />
        </Field>
        <Field label="Text font">
          <FontSelect fonts={textFonts} value={settings.editor.fonts.text} onChange={(text) => setFonts({ text })} />
        </Field>
        <Field label="Code font">
          <FontSelect fonts={codeFonts} value={settings.editor.fonts.code} onChange={(code) => setFonts({ code })} />
        </Field>
        <Field label="Wrap long lines">
          <Switch
            checked={settings.editor.lineWrap}
            onCheckedChange={(lineWrap) => update({ editor: { ...settings.editor, lineWrap } })}
          />
        </Field>
      </Section>

      <ConfirmDialog
        request={confirmation}
        onClose={() => {
          setConfirmation(null)
          setRevision(revision + 1)
        }}
      />
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** A setting on one line: its name on the left, its control on the right. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-h-8 items-center justify-between gap-3">
      {label}
      <span className="flex items-center gap-3">{children}</span>
    </label>
  )
}

interface FontSelectProps<Id extends string> {
  fonts: Record<Id, { name: string; family: string }>
  value: Id
  onChange: (font: Id) => void
}

/** Each font is listed in itself, so it can be judged before it is picked. */
function FontSelect<Id extends string>({ fonts, value, onChange }: FontSelectProps<Id>) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" style={{ fontFamily: fonts[value].family }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(Object.keys(fonts) as Id[]).map((id) => (
            <SelectItem key={id} value={id} style={{ fontFamily: fonts[id].family }}>
              {fonts[id].name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

interface CommandInputProps {
  value: string | undefined
  placeholder?: string
  onCommit: (command: string) => void
}

/** Saved when the field loses focus, not on every keystroke. */
function CommandInput({ value = '', placeholder, onCommit }: CommandInputProps) {
  return (
    <Input
      key={value}
      className="font-mono text-xs md:text-xs"
      defaultValue={value}
      placeholder={placeholder}
      spellCheck={false}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
    />
  )
}
