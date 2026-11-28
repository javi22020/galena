import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { codeFonts, textFonts } from '../../shared/fonts'
import type { Settings as SettingsData, TranscriptionModel } from '../../shared/types'
import { api } from '../api'
import { saveSettings, showError, useStore } from '../store'
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

      <TranscriptionSection />

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

/** The provider's API key and model for voice dictation. */
function TranscriptionSection() {
  const state = useStore((s) => s.transcription)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<TranscriptionModel[] | null>(null)
  const configured = !!state?.configured

  // The models depend on the key, so they are asked for whenever one is set.
  useEffect(() => {
    if (!configured) return
    let current = true
    api.transcriptionModels().then((list) => current && setModels(list), showError)
    return () => {
      current = false
      setModels(null)
    }
  }, [configured])

  if (!state) return null

  const apply = async (change: { key?: string | null; model?: string | null }) => {
    setBusy(true)
    try {
      useStore.setState({ transcription: await api.setTranscription(change) })
      return true
    } catch (error) {
      showError(error)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async (event: FormEvent) => {
    event.preventDefault()
    if (key.trim() && (await apply({ key }))) setKey('')
  }

  // A picked model is listed even when the provider no longer offers it, so the choice shows.
  const picked = state.model
  const missing = picked !== null && models !== null && !models.some((m) => m.id === picked)
  const options = models && picked !== null && missing ? [{ id: picked, name: picked }, ...models] : models

  return (
    <Section
      title="Dictation"
      description={`Dictate into notes from a bar at the bottom of the editor, transcribed by ${state.providerName}. The API key is kept in Galena's folder in your user configuration, readable only by you, and never sent to the browser.`}
    >
      {configured ? (
        <Field label={`${state.providerName} API key`}>
          <Badge variant="secondary">Saved</Badge>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void apply({ key: null })}>
            Remove
          </Button>
        </Field>
      ) : (
        <form onSubmit={(e) => void saveKey(e)} className="flex gap-2">
          <Input
            type="password"
            className="min-w-0 flex-1 font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={`${state.providerName} API key`}
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="outline" disabled={busy || !key.trim()}>
            {busy ? 'Checking…' : 'Save'}
          </Button>
        </form>
      )}
      {!configured && (
        <p className="text-[13px] text-muted-foreground">
          <a
            href={state.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline decoration-1 underline-offset-3"
          >
            Get a {state.providerName} API key
          </a>
        </p>
      )}
      {configured && (
        <Field label="Model">
          {/* An empty value shows the placeholder: no model is picked for the user. */}
          <Select value={picked ?? ''} disabled={!options?.length || busy} onValueChange={(model) => void apply({ model })}>
            <SelectTrigger className="w-64 font-mono text-xs">
              <SelectValue placeholder={options ? 'Pick a model' : 'Loading models…'} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(options ?? []).map((model) => (
                  <SelectItem key={model.id} value={model.id} className="font-mono text-xs">
                    {model.id}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      {configured && picked === null && !!models?.length && (
        <p className="text-[13px] text-muted-foreground">Pick a model to start dictating.</p>
      )}
      {configured && missing && (
        <p className="text-[13px] text-warning">
          {state.providerName} no longer lists {picked}; pick one of the models it offers.
        </p>
      )}
      {configured && models?.length === 0 && (
        <p className="text-[13px] text-warning">
          {state.providerName} lists no transcription model for this key, so there is none to dictate with.
        </p>
      )}
    </Section>
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
