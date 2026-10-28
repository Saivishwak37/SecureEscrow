import { useState, useCallback, useEffect } from "react"
import * as api from "./services/api"
import type {
  BackendUser, BackendAccount, BackendTransaction, BackendLedgerEntry, MilestoneStatus,
} from "./services/api"

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = "dashboard" | "escrow" | "transactions" | "ledger" | "accounts"
type Role = "CLIENT" | "FREELANCER"
// EscrowState mirrors the backend's milestone status values (the backend's
// escrow-level `status` field is never transitioned by any route — only
// milestones move through this lifecycle — so the frontend derives a
// display "escrow state" from its milestones; see deriveEscrowState()).
type EscrowState = MilestoneStatus
type ReleaseModel = "Milestone Based" | "Condition Based"

interface Milestone {
  id: string
  title: string
  amount: number
  description: string
  state: EscrowState
  order: number
}

interface Escrow {
  id: string
  title: string
  description: string
  domain: string
  providerName: string
  providerId: string
  clientId: string
  totalAmount: number
  releaseModel: ReleaseModel
  state: EscrowState
  milestones: Milestone[]
  createdAt: string
}

interface Transaction {
  id: string
  type: "FUND" | "RELEASE" | "REFUND"
  escrowId: string
  escrowTitle: string
  milestoneId: string
  amount: number
  from: string
  to: string
  fromAccountId: string
  toAccountId: string
  status: "COMPLETED" | "PENDING" | "FAILED"
  timestamp: string
}

interface LedgerEntry {
  txId: string
  txType: "FUND" | "RELEASE" | "REFUND"
  account: string
  entryType: "DEBIT" | "CREDIT"
  amount: number
  balance: number
}

interface Toast {
  id: string
  type: "success" | "error" | "info"
  title: string
  message?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_ORDER: EscrowState[] = [
  "CREATED", "FUNDED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "RELEASED",
]

const LIFECYCLE = [
  { state: "CREATED" as EscrowState, label: "Created", desc: "Escrow agreement created" },
  { state: "FUNDED" as EscrowState, label: "Funded", desc: "Funds deposited into escrow" },
  { state: "IN_PROGRESS" as EscrowState, label: "In Progress", desc: "Provider is working on the milestone" },
  { state: "SUBMITTED" as EscrowState, label: "Submitted", desc: "Work submitted for review" },
  { state: "UNDER_REVIEW" as EscrowState, label: "Under Review", desc: "Client reviewing the submission" },
  { state: "APPROVED" as EscrowState, label: "Approved", desc: "Client approved the milestone" },
  { state: "RELEASED" as EscrowState, label: "Released", desc: "Payment released to provider" },
]


// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`
const stateIdx = (s: EscrowState) => Math.max(0, STATE_ORDER.indexOf(s))
const genId = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const fmtTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19)
// Real IDs from the backend are UUIDs; show a short human-readable form in
// dense UI while all API requests still use the full UUID (escrow.id / m.id).
const shortId = (id: string) => id.slice(0, 8).toUpperCase()

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/** The backend never transitions an escrow's own `status` field — only its
 * milestones move through the lifecycle. This derives a single display
 * state for an escrow from its milestones: the state of the earliest
 * (lowest `order`) milestone that hasn't been released yet, or RELEASED
 * once every milestone has been released. */
function deriveEscrowState(milestones: Milestone[]): EscrowState {
  if (milestones.length === 0) return "CREATED"
  if (milestones.every(m => m.state === "RELEASED")) return "RELEASED"
  const sorted = [...milestones].sort((a, b) => a.order - b.order)
  return sorted.find(m => m.state !== "RELEASED")?.state ?? "CREATED"
}

function extractApiErrorMessage(err: unknown): string {
  if (err instanceof api.ApiError) return err.message
  if (err instanceof Error) return err.message
  return "Something went wrong."
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ShieldIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
}
function GridIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg> }
function LockIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> }
function ArrowsIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg> }
function BookIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg> }
function UsersIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> }
function PlusIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> }
function ArrowLeftIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg> }
function CheckIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> }
function XIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg> }
function ChevronRightIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg> }
function LogOutIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg> }
function SpinnerIcon() { return <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" /></svg> }
function ArrowRightIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg> }

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ state }: { state: string }) {
  const map: Record<string, string> = {
    IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
    COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    RELEASED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    FUNDED: "bg-violet-50 text-violet-700 border-violet-200",
    CREATED: "bg-slate-100 text-slate-600 border-slate-200",
    SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
    UNDER_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
    FAILED: "bg-red-50 text-red-700 border-red-200",
    DEBIT: "bg-red-50 text-red-700 border-red-200",
    CREDIT: "bg-emerald-50 text-emerald-700 border-emerald-200",
    FUND: "bg-violet-50 text-violet-700 border-violet-200",
    RELEASE: "bg-blue-50 text-blue-700 border-blue-200",
    CLIENT: "bg-blue-50 text-blue-700 border-blue-200",
    FREELANCER: "bg-violet-50 text-violet-700 border-violet-200",
  }
  const cls = map[state] ?? "bg-slate-100 text-slate-600 border-slate-200"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono border tracking-wide ${cls}`}>
      {state.replace(/_/g, " ")}
    </span>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

function Btn({ children, onClick, variant = "primary", disabled = false, loading = false, size = "md", className = "" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger" | "outline"
  disabled?: boolean; loading?: boolean; size?: "sm" | "md" | "lg"; className?: string
}) {
  const base = "inline-flex items-center gap-2 font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 cursor-pointer"
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100 focus:ring-slate-400",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-400 bg-white",
  }
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${disabled || loading ? "opacity-50 cursor-not-allowed" : ""} ${className}`}>
      {loading && <SpinnerIcon />}
      {children}
    </button>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ open, onClose, children, wide = false }: { open: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full z-10 overflow-hidden ${wide ? "max-w-2xl" : "max-w-md"}`}>
        {children}
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm pointer-events-auto min-w-72 max-w-80 bg-white ${
          t.type === "success" ? "border-emerald-200" : t.type === "error" ? "border-red-200" : "border-blue-200"}`}>
          <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
            t.type === "success" ? "bg-emerald-100 text-emerald-600" : t.type === "error" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
            {t.type === "success" ? <CheckIcon size={10} /> : t.type === "error" ? <XIcon size={10} /> : <span className="text-xs font-bold leading-none">i</span>}
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-900 text-sm">{t.title}</p>
            {t.message && <p className="text-slate-500 text-xs mt-0.5">{t.message}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5"><XIcon size={14} /></button>
        </div>
      ))}
    </div>
  )
}

// ─── Account Selection Page ───────────────────────────────────────────────────

function AccountSelectionPage({ users, loading, error, onRetry, onSelect }: {
  users: BackendUser[]; loading: boolean; error: string | null; onRetry: () => void; onSelect: (role: Role) => void
}) {
  const clientUser = users.find(u => u.type === "CLIENT")
  const freelancerUser = users.find(u => u.type === "FREELANCER")

  const cards = [
    {
      role: "CLIENT" as Role,
      name: clientUser?.name ?? "Test Client",
      badge: "CLIENT",
      subtitle: "Client / Payer",
      description: "Create escrow agreements, fund milestones, review submissions, and release payments.",
      buttonLabel: "Continue as Client",
      accent: "border-blue-200 hover:border-blue-400 hover:shadow-blue-100",
      avatarBg: "bg-blue-600",
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
      btnClass: "bg-blue-600 text-white hover:bg-blue-700",
    },
    {
      role: "FREELANCER" as Role,
      name: freelancerUser?.name ?? "Test Freelancer",
      badge: "FREELANCER",
      subtitle: "Provider",
      description: "Manage assigned milestones, submit completed work, and receive released payments.",
      buttonLabel: "Continue as Freelancer",
      accent: "border-violet-200 hover:border-violet-400 hover:shadow-violet-100",
      avatarBg: "bg-violet-600",
      badgeColor: "bg-violet-50 text-violet-700 border-violet-200",
      btnClass: "bg-violet-600 text-white hover:bg-violet-700",
    },
  ]

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
        <SpinnerIcon />
        <p className="text-slate-400 text-sm mt-3">Connecting to SecureEscrow backend…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4"><XIcon size={22} /></div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Can't reach the backend</h1>
        <p className="text-slate-500 text-sm max-w-sm mb-6">{error}</p>
        <Btn onClick={onRetry}>Retry</Btn>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white">
          <ShieldIcon size={20} />
        </div>
        <div>
          <p className="text-slate-900 font-bold text-lg leading-tight">SecureEscrow</p>
          <p className="text-slate-400 text-xs">Secure transactions. Conditional release. Complete trust.</p>
        </div>
      </div>

      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-slate-900">Select Account</h1>
        <p className="text-slate-500 mt-2">Choose an account to continue.</p>
      </div>

      <div className="grid grid-cols-2 gap-5 w-full max-w-2xl">
        {cards.map(c => (
          <div key={c.role}
            className={`bg-white rounded-2xl border-2 ${c.accent} p-7 flex flex-col items-center text-center shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer group`}
            onClick={() => onSelect(c.role)}>
            {/* Avatar */}
            <div className={`w-16 h-16 ${c.avatarBg} rounded-2xl flex items-center justify-center text-white text-xl font-bold mb-5 group-hover:scale-105 transition-transform`}>
              {c.name.split(" ").map(w => w[0]).join("")}
            </div>
            {/* Name + badge */}
            <p className="text-xl font-bold text-slate-900 mb-2">{c.name}</p>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded border text-xs font-semibold font-mono tracking-wider ${c.badgeColor} mb-1`}>
              {c.badge}
            </span>
            <p className="text-sm text-slate-400 mb-4">{c.subtitle}</p>
            <p className="text-sm text-slate-500 leading-relaxed mb-7">{c.description}</p>
            <button
              onClick={() => onSelect(c.role)}
              className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 ${c.btnClass}`}>
              {c.buttonLabel} <ArrowRightIcon />
            </button>
          </div>
        ))}
      </div>

      <p className="text-slate-400 text-xs mt-10 text-center max-w-sm">
        Both accounts share the same escrow state, transactions, and ledger — reflecting a real two-participant transaction.
      </p>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV = [
  { id: "dashboard", label: "Overview", icon: GridIcon },
  { id: "escrow", label: "Escrows", icon: LockIcon },
  { id: "transactions", label: "Transactions", icon: ArrowsIcon },
  { id: "accounts", label: "Accounts", icon: UsersIcon },
  { id: "ledger", label: "Ledger", icon: BookIcon },
] as const

function Sidebar({ page, setPage, role, user, onSwitch }: {
  page: Page; setPage: (p: Page) => void; role: Role; user: BackendUser; onSwitch: () => void
}) {
  const initials = user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
  return (
    <aside className="w-60 bg-slate-900 flex flex-col flex-shrink-0 h-screen sticky top-0">
      <div className="px-5 py-6 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white flex-shrink-0">
            <ShieldIcon size={16} />
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">SecureEscrow</p>
            <p className="text-slate-500 text-xs">Transaction Platform</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id
          return (
            <button key={id} onClick={() => setPage(id as Page)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 text-left ${
                active ? "bg-blue-600 text-white font-medium" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}>
              <Icon />{label}
            </button>
          )
        })}
      </nav>

      {/* Profile */}
      <div className="px-3 py-4 border-t border-slate-800">
        <div className="px-3 py-3.5 rounded-xl bg-slate-800">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${role === "CLIENT" ? "bg-blue-600" : "bg-violet-600"}`}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-slate-200 text-sm font-semibold truncate">{user.name}</p>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold font-mono tracking-wider border ${
                role === "CLIENT" ? "bg-blue-900/60 text-blue-300 border-blue-700" : "bg-violet-900/60 text-violet-300 border-violet-700"}`}>
                {role}
              </span>
            </div>
          </div>
          <button onClick={onSwitch}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-xs font-medium transition-all">
            <LogOutIcon /> Switch Account
          </button>
        </div>
      </div>
    </aside>
  )
}

// ─── Escrow Card ──────────────────────────────────────────────────────────────

function EscrowCard({ escrow, role, clientName, onClick }: { escrow: Escrow; role: Role; clientName: string; onClick: () => void }) {
  const idx = stateIdx(escrow.state)
  const progress = Math.round((idx / (STATE_ORDER.length - 1)) * 100)

  return (
    <div onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-blue-300 hover:shadow-md transition-all duration-200 cursor-pointer group">
      <div className="p-5 border-b border-slate-100 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h3 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{escrow.title}</h3>
            <Badge state={escrow.state} />
          </div>
          <p className="text-xs text-slate-400">{escrow.domain} · {shortId(escrow.id)}</p>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-xl font-bold font-mono text-slate-900">{fmt(escrow.totalAmount)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{escrow.milestones.length} milestone{escrow.milestones.length !== 1 ? "s" : ""}</p>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
          <div>
            <p className="text-slate-400 uppercase tracking-wide font-medium mb-1">{role === "CLIENT" ? "Provider" : "Client"}</p>
            <p className="text-slate-700 font-medium">{role === "CLIENT" ? escrow.providerName : clientName}</p>
          </div>
          <div>
            <p className="text-slate-400 uppercase tracking-wide font-medium mb-1">Release Model</p>
            <p className="text-slate-700 font-medium">{escrow.releaseModel}</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-slate-400">Lifecycle progress</span>
            <span className="font-mono font-medium text-slate-600">{progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
        <p className="text-xs text-slate-400">{escrow.createdAt.slice(0, 10)}</p>
        <span className="text-xs text-blue-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
          View Escrow <ChevronRightIcon />
        </span>
      </div>
    </div>
  )
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

function DashboardPage({ escrows, transactions, role, user, clientName, clientBalance, freelancerBalance, setPage, setSelectedEscrowId, onCreateEscrow }: {
  escrows: Escrow[]; transactions: Transaction[]; role: Role; user: BackendUser; clientName: string
  clientBalance: number; freelancerBalance: number
  setPage: (p: Page) => void; setSelectedEscrowId: (id: string) => void; onCreateEscrow: () => void
}) {
  const activeEscrows = escrows.filter(e => e.state !== "RELEASED")
  const totalEscrowed = activeEscrows.reduce((s, e) => s + e.totalAmount, 0)
  const totalReleased = transactions.filter(t => t.type === "RELEASE" && t.status === "COMPLETED").reduce((s, t) => s + t.amount, 0)
  const pendingReview = escrows.flatMap(e => e.milestones).filter(m => m.state === "SUBMITTED").length

  const clientCards = [
    { label: "Available Balance", value: fmt(clientBalance), sub: "Client account" },
    { label: "Active Escrows", value: String(activeEscrows.length), sub: "In progress" },
    { label: "Total Escrowed", value: fmt(totalEscrowed), sub: "Held in escrow" },
    { label: "Released", value: fmt(totalReleased), sub: "Payments completed" },
  ]
  const freelancerCards = [
    { label: "Available Balance", value: fmt(freelancerBalance), sub: "Received to date" },
    { label: "Active Work", value: String(escrows.flatMap(e => e.milestones).filter(m => m.state === "IN_PROGRESS").length), sub: "Milestones in progress" },
    { label: "Pending Review", value: String(pendingReview), sub: "Awaiting client review" },
    { label: "Released", value: fmt(totalReleased), sub: "Total earnings" },
  ]

  const cards = role === "CLIENT" ? clientCards : freelancerCards
  const sectionLabel = role === "CLIENT" ? "My Escrows" : "Assigned Escrows"
  const emptyLabel = role === "CLIENT" ? "No escrow agreements yet." : "No escrows assigned."

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{greeting()}, {user.name}</h1>
            <p className="text-slate-500 text-sm mt-1">
              {role === "CLIENT"
                ? "Manage your escrow agreements and release payments securely."
                : "Track your active work, milestones, and payments."}
            </p>
          </div>
          {role === "CLIENT" && <Btn onClick={onCreateEscrow}><PlusIcon /> Create Escrow</Btn>}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {cards.map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">{c.label}</p>
              <p className="text-2xl font-bold text-slate-900 font-mono">{c.value}</p>
              <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Escrows */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">{sectionLabel}</h2>
            {escrows.length > 2 && (
              <button onClick={() => setPage("escrow")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">View all →</button>
            )}
          </div>
          {escrows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="font-medium text-slate-700">{emptyLabel}</p>
              {role === "CLIENT" && (
                <><p className="text-slate-400 text-sm mt-1 mb-4">Create your first escrow to get started.</p>
                  <Btn onClick={onCreateEscrow} size="sm"><PlusIcon size={14} /> Create Escrow</Btn></>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {escrows.slice(0, 4).map(e => (
                <EscrowCard key={e.id} escrow={e} role={role} clientName={clientName} onClick={() => { setSelectedEscrowId(e.id); setPage("escrow") }} />
              ))}
            </div>
          )}
        </div>

        {/* Bottom */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Recent Transactions</h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {transactions.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">No transactions yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {transactions.slice(-4).reverse().map(tx => (
                    <div key={tx.id} className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Badge state={tx.type} />
                        <div>
                          <p className="text-sm font-medium text-slate-800">{tx.from} → {tx.to}</p>
                          <p className="text-xs text-slate-400 font-mono">{tx.id}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold font-mono text-slate-900">{fmt(tx.amount)}</p>
                        <Badge state={tx.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-5 py-3 border-t border-slate-100">
                <button onClick={() => setPage("transactions")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">View all →</button>
              </div>
            </div>
          </div>

          <div>
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
      Recent Ledger
    </h2>
    <button
      onClick={() => setPage("ledger")}
      className="text-xs font-medium text-blue-600 hover:text-blue-700"
    >
      View All
    </button>
  </div>

  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
    {transactions.length === 0 ? (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-400">
          No ledger transactions yet.
        </p>
      </div>
    ) : (
      <div className="divide-y divide-slate-100">
        {transactions.slice(0, 4).map(tx => (
          <div
            key={tx.id}
            className="px-4 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                  tx.type === "FUND"
                    ? "bg-blue-50 text-blue-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                {tx.type === "FUND" ? "↓" : "↑"}
              </div>

              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {tx.type === "FUND"
                    ? "Funds Added to Escrow"
                    : "Payment Released"}
                </p>

                <p className="text-[11px] text-slate-400 font-mono truncate">
                  {shortId(tx.id)} · {tx.timestamp}
                </p>
              </div>
            </div>

            <div className="text-right ml-3">
              <p className="text-sm font-semibold font-mono text-slate-800">
                {fmt(tx.amount)}
              </p>
              <p className="text-[10px] text-emerald-600 font-medium">
                {tx.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
</div>
        </div>
      </div>
    </div>
  )
}

// ─── Escrow List Page ─────────────────────────────────────────────────────────

function EscrowListPage({ escrows, role, clientName, setSelectedEscrowId, onCreateEscrow }: {
  escrows: Escrow[]; role: Role; clientName: string; setSelectedEscrowId: (id: string) => void; onCreateEscrow: () => void
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Escrows</h1>
            <p className="text-slate-500 text-sm mt-1">{escrows.length} agreement{escrows.length !== 1 ? "s" : ""} total.</p>
          </div>
          {role === "CLIENT" && <Btn onClick={onCreateEscrow}><PlusIcon /> Create Escrow</Btn>}
        </div>
        {escrows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <p className="font-medium text-slate-700">No escrow agreements</p>
            {role === "CLIENT" && <><p className="text-slate-400 text-sm mt-1 mb-4">Create your first escrow to get started.</p>
              <Btn onClick={onCreateEscrow} size="sm"><PlusIcon size={14} /> Create Escrow</Btn></>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {escrows.map(e => (
              <EscrowCard key={e.id} escrow={e} role={role} clientName={clientName} onClick={() => setSelectedEscrowId(e.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Lifecycle Timeline ───────────────────────────────────────────────────────

function LifecycleTimeline({ current }: { current: EscrowState }) {
  const currentIdx = stateIdx(current)
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-6">Lifecycle</h3>
      <div className="relative">
        <div className="absolute left-4 top-4 bottom-4 w-px bg-slate-200" />
        <div className="absolute left-4 top-4 w-px bg-blue-500 transition-all duration-500"
          style={{ height: `${Math.max(0, (currentIdx / (STATE_ORDER.length - 1)) * 100)}%` }} />
        <div className="space-y-0">
          {LIFECYCLE.map(({ state, label, desc }, i) => {
            const done = i < currentIdx, active = i === currentIdx
            return (
              <div key={state} className={`flex gap-5 ${i < LIFECYCLE.length - 1 ? "pb-5" : ""}`}>
                <div className="relative z-10 flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    done ? "bg-blue-600 border-blue-600 text-white" :
                    active ? "bg-white border-blue-600 text-blue-600 ring-4 ring-blue-100" :
                    "bg-white border-slate-300 text-slate-400"}`}>
                    {done ? <CheckIcon size={12} /> : active ? <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" /> : <div className="w-2 h-2 bg-slate-300 rounded-full" />}
                  </div>
                </div>
                <div className="pt-1">
                  <p className={`text-sm font-semibold ${active ? "text-blue-700" : done ? "text-slate-700" : "text-slate-400"}`}>{label}</p>
                  <p className={`text-xs mt-0.5 ${active ? "text-blue-500" : "text-slate-400"}`}>{desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Milestone Card ───────────────────────────────────────────────────────────

function MilestoneCard({ milestone, role, onAction, loadingAction }: {
  milestone: Milestone; role: Role
  onAction: (action: string, milestoneId: string) => void; loadingAction: string | null
}) {
  const idx = stateIdx(milestone.state)
  const progress = Math.round((idx / (STATE_ORDER.length - 1)) * 100)

  // CLIENT actions
  const clientActions: Partial<Record<EscrowState, { label: string; action: string; variant: "primary" | "secondary" | "danger" }>> = {
    CREATED: { label: "Fund Escrow", action: "FUND", variant: "primary" },
    SUBMITTED: { label: "Begin Review", action: "REVIEW", variant: "secondary" },
    UNDER_REVIEW: { label: "Approve Milestone", action: "APPROVE", variant: "primary" },
    APPROVED: { label: "Release Payment", action: "RELEASE", variant: "primary" },
  }
  // FREELANCER actions
  const freelancerActions: Partial<Record<EscrowState, { label: string; action: string; variant: "primary" | "secondary" }>> = {
    FUNDED: { label: "Start Work", action: "START", variant: "primary" },
    IN_PROGRESS: { label: "Submit for Review", action: "SUBMIT", variant: "primary" },
  }

  const actionMap = role === "CLIENT" ? clientActions : freelancerActions
  const currentAction = actionMap[milestone.state]
  const isLoading = loadingAction === `${milestone.id}-${currentAction?.action}`

  const waitingMessage: Partial<Record<EscrowState, string>> = role === "CLIENT" ? {
    FUNDED: "Waiting for provider to start work.",
    IN_PROGRESS: "Provider is working — waiting for submission.",
    RELEASED: "Payment has been released.",
  } : {
    CREATED: "Waiting for client to fund this milestone.",
    SUBMITTED: "Waiting for client to begin review.",
    UNDER_REVIEW: "Client is reviewing — waiting for approval.",
    APPROVED: "Approved — awaiting payment release by client.",
    RELEASED: "Payment received.",
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400 font-mono font-medium mb-0.5">{shortId(milestone.id)}</p>
          <h3 className="text-base font-semibold text-slate-900">{milestone.title}</h3>
          {milestone.description && <p className="text-xs text-slate-500 mt-0.5">{milestone.description}</p>}
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-xl font-bold font-mono text-slate-900">{fmt(milestone.amount)}</p>
          <div className="mt-1"><Badge state={milestone.state} /></div>
        </div>
      </div>
      <div className="px-6 py-5">
        <div className="mb-5">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-slate-500">Completion</span>
            <span className="font-mono font-medium text-slate-700">{progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${progress}%`, background: progress === 100 ? "#10B981" : "#2563EB" }} />
          </div>
        </div>

        <div className="bg-slate-50 rounded-lg px-4 py-3 mb-5 text-xs">
          <p className="text-slate-400 mb-1">Current state</p>
          <Badge state={milestone.state} />
          <p className="text-slate-500 mt-2">{LIFECYCLE.find(l => l.state === milestone.state)?.desc}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {currentAction ? (
            <Btn variant={currentAction.variant as "primary" | "secondary"} loading={isLoading}
              onClick={() => onAction(currentAction.action, milestone.id)}>
              {currentAction.label}
            </Btn>
          ) : (
            <p className="text-xs text-slate-400 italic">
              {waitingMessage[milestone.state] ?? "No action available in this state."}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Escrow Details Page ──────────────────────────────────────────────────────

function EscrowDetailsPage({ escrow, role, clientName, onAction, loadingAction, onBack }: {
  escrow: Escrow; role: Role; clientName: string
  onAction: (action: string, milestoneId: string) => void
  loadingAction: string | null; onBack: () => void
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6">
          <ArrowLeftIcon /> Back to Escrows
        </button>

        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-slate-900">{escrow.title}</h1>
              <Badge state={escrow.state} />
            </div>
            <p className="text-slate-500 text-sm">{escrow.domain} · {shortId(escrow.id)} · {escrow.releaseModel}</p>
            {escrow.description && <p className="text-slate-400 text-sm mt-1">{escrow.description}</p>}
          </div>
          <div className="text-right flex-shrink-0 ml-6">
            <p className="text-3xl font-bold font-mono text-slate-900">{fmt(escrow.totalAmount)}</p>
            <p className="text-xs text-slate-400 mt-1">Total escrow value</p>
          </div>
        </div>

        {/* Participants */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[
            { roleLabel: "Client / Payer", name: clientName, id: escrow.clientId, note: "Approves and releases funds", badge: "CLIENT", isMe: role === "CLIENT" },
            { roleLabel: "Provider / Payee", name: escrow.providerName, id: escrow.providerId, note: "Delivers work, receives payment", badge: "FREELANCER", isMe: role === "FREELANCER" },
          ].map(p => (
            <div key={p.roleLabel} className={`bg-white rounded-xl border px-5 py-4 flex items-center gap-4 ${p.isMe ? "border-blue-200 bg-blue-50/30" : "border-slate-200"}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${p.badge === "CLIENT" ? "bg-blue-600" : "bg-violet-600"}`}>
                {p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{p.roleLabel}</p>
                  <Badge state={p.badge} />
                  {p.isMe && <span className="text-xs text-blue-600 font-medium">(you)</span>}
                </div>
                <p className="font-semibold text-slate-900 text-sm">{p.name}</p>
                <p className="text-xs text-slate-400 font-mono">{p.id} · {p.note}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Layout */}
        <div className="grid grid-cols-[260px_1fr] gap-6">
          <LifecycleTimeline current={escrow.state} />
          <div className="space-y-4">
            {/* Role context */}
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium ${
              role === "CLIENT" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-violet-50 border-violet-200 text-violet-700"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${role === "CLIENT" ? "bg-blue-500" : "bg-violet-500"}`} />
              {role === "CLIENT"
                ? "You are the client — you can fund, review, approve, and release payment."
                : "You are the provider — you can start work and submit for review."}
            </div>

            {escrow.milestones.map(m => (
              <MilestoneCard key={m.id} milestone={m} role={role} onAction={onAction} loadingAction={loadingAction} />
            ))}

            {/* Meta */}
            <div className="bg-white rounded-xl border border-slate-200 px-6 py-5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Agreement Details</h3>
              <div className="grid grid-cols-2 gap-y-3 text-xs">
                {[["Escrow ID", shortId(escrow.id)], ["Domain", escrow.domain], ["Release Model", escrow.releaseModel],
                  ["Created", escrow.createdAt.slice(0, 10)], ["Provider", escrow.providerName], ["Provider ID", escrow.providerId]
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-slate-400">{k}</p>
                    <p className="text-slate-800 font-medium font-mono mt-0.5">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Transactions Page ────────────────────────────────────────────────────────

function TransactionsPage({ transactions, currentAccountId, onViewLedger }: {
  transactions: Transaction[]
  currentAccountId: string
  onViewLedger: () => void
}) {
  const [selected, setSelected] = useState<Transaction | null>(null)

  // Show only transactions that involve the currently selected user's account.
  // The backend remains the source of truth; this is only a role/account view filter.
  const visibleTransactions = transactions.filter(
    tx => tx.fromAccountId === currentAccountId || tx.toAccountId === currentAccountId
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
            <p className="text-slate-500 text-sm mt-1">Financial movements involving your account.</p>
          </div>
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-sm text-slate-600">
            <span className="font-mono font-medium">{visibleTransactions.length}</span> records
          </div>
        </div>
        <div className="grid grid-cols-[1fr_320px] gap-5">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {["Transaction", "Type", "Flow", "Amount", "Status"].map(h => (
                    <th key={h} className={`py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visibleTransactions.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400 text-sm">No transactions recorded yet.</td></tr>}
                {visibleTransactions.map(tx => (
                  <tr key={tx.id} onClick={() => setSelected(tx)}
                    className={`cursor-pointer hover:bg-slate-50 transition-colors ${selected?.id === tx.id ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-4"><p className="font-mono text-xs text-slate-400">{shortId(tx.id)}</p><p className="text-slate-600 text-xs mt-0.5 truncate max-w-32">{tx.escrowTitle}</p></td>
                    <td className="px-4 py-4"><Badge state={tx.type} /></td>
                    <td className="px-4 py-4 text-xs text-slate-600">{tx.from} → {tx.to}</td>
                    <td className="px-4 py-4 text-right font-mono font-semibold text-slate-900">{fmt(tx.amount)}</td>
                    <td className="px-4 py-4"><Badge state={tx.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            {selected ? (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 text-sm">Details</h3>
                  <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600"><XIcon size={14} /></button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="flex justify-between"><Badge state={selected.type} /><Badge state={selected.status} /></div>
                  <div><p className="text-3xl font-bold font-mono text-slate-900">{fmt(selected.amount)}</p><p className="text-xs text-slate-400 mt-1">{selected.timestamp}</p></div>
                  <div className="space-y-3">
                    {[["Transaction ID", shortId(selected.id)], ["Source", selected.from], ["Destination", selected.to],
                      ["Escrow", shortId(selected.escrowId)], ["Milestone", shortId(selected.milestoneId)]].map(([k, v]) => (
                      <div key={k}><span className="text-xs text-slate-400 block">{k}</span><span className="font-mono text-xs text-slate-700 font-medium">{v}</span></div>
                    ))}
                  </div>
                  <Btn variant="outline" size="sm" className="w-full justify-center" onClick={onViewLedger}>View Ledger Entries</Btn>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                <p className="text-slate-400 text-sm">Select a transaction to view details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Ledger Page ──────────────────────────────────────────────────────────────

function LedgerPage({ entries, summary }: {
  entries: LedgerEntry[]
  summary: { totalDebits: number; totalCredits: number; balanced: boolean; transactionsValidated: number } | null
}) {
  const localDebits = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + e.amount, 0)
  const localCredits = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + e.amount, 0)
  // Prefer the backend's own GET /api/transactions/validation/ledger result
  // (the actual source of truth for whether the ledger is balanced); fall
  // back to a local recomputation from the fetched entries if unavailable.
  const totalDebits = summary?.totalDebits ?? localDebits
  const totalCredits = summary?.totalCredits ?? localCredits
  const balanced = summary?.balanced ?? (totalDebits === totalCredits)
  const transactionsValidated = summary?.transactionsValidated ?? Math.floor(entries.length / 2)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Double-Entry Ledger</h1>
          <p className="text-slate-500 text-sm mt-1">Every financial transaction is represented by balanced debit and credit entries.</p>
        </div>
        <div className={`rounded-xl border p-6 mb-8 ${balanced ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white ${balanced ? "bg-emerald-500" : "bg-red-500"}`}>
              {balanced ? <CheckIcon size={16} /> : <XIcon size={16} />}
            </div>
            <div>
              <p className={`font-bold text-base ${balanced ? "text-emerald-800" : "text-red-800"}`}>{balanced ? "Ledger Balanced" : "Imbalance Detected"}</p>
              <p className={`text-xs ${balanced ? "text-emerald-600" : "text-red-600"}`}>{balanced ? "All debit and credit entries are balanced." : "Debits and credits do not match."}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {[["Total Debits", fmt(totalDebits)], ["Total Credits", fmt(totalCredits)], ["Transactions Validated", String(transactionsValidated)]].map(([l, v]) => (
              <div key={l}>
                <p className={`text-xs font-medium uppercase tracking-wide ${balanced ? "text-emerald-600" : "text-red-600"}`}>{l}</p>
                <p className={`text-2xl font-bold font-mono mt-1 ${balanced ? "text-emerald-900" : "text-red-900"}`}>{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Transaction</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Account</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Entry</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-red-500 uppercase tracking-wider">Debit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-emerald-600 uppercase tracking-wider">Credit</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entries.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-sm">No ledger entries yet.</td></tr>}
              {entries.map((e, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4"><Badge state={e.txType} /><p className="font-mono text-xs text-slate-400 mt-1">{shortId(e.txId)}</p></td>
                  <td className="px-4 py-4 text-xs text-slate-700 font-medium">{e.account}</td>
                  <td className="px-4 py-4"><Badge state={e.entryType} /></td>
                  <td className="px-4 py-4 text-right font-mono text-sm">{e.entryType === "DEBIT" ? <span className="text-red-600 font-semibold">{fmt(e.amount)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm">{e.entryType === "CREDIT" ? <span className="text-emerald-600 font-semibold">{fmt(e.amount)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-5 py-4 text-right font-mono text-sm font-semibold text-slate-700">{fmt(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Totals</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{fmt(totalDebits)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{fmt(totalCredits)}</td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Accounts Page ────────────────────────────────────────────────────────────

function AccountsPage({ currentAccountId, clientAccount, freelancerAccount, escrowAccount, clientName, freelancerName }: {
  currentAccountId: string
  clientAccount: BackendAccount | null; freelancerAccount: BackendAccount | null; escrowAccount: BackendAccount | null
  clientName: string; freelancerName: string
}) {
  const currentIsClient = currentAccountId === clientAccount?.id
  const currentAccount = currentIsClient ? clientAccount : freelancerAccount

  const accounts = [
    currentIsClient
      ? { type: "CLIENT ACCOUNT", name: clientName, id: shortId(currentAccount?.id ?? ""), label: "Available Balance", balance: currentAccount?.balance ?? 0, color: "border-blue-200 bg-blue-50", dot: "bg-blue-500" }
      : { type: "PROVIDER ACCOUNT", name: freelancerName, id: shortId(currentAccount?.id ?? ""), label: "Available Balance", balance: currentAccount?.balance ?? 0, color: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500" },
    { type: "ESCROW ACCOUNT", name: "Held In Escrow", id: shortId(escrowAccount?.id ?? ""), label: "Total Held", balance: escrowAccount?.balance ?? 0, color: "border-violet-200 bg-violet-50", dot: "bg-violet-500" },
  ]
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
          <p className="text-slate-500 text-sm mt-1">Your account balance and funds currently held in escrow.</p>
        </div>
        <div className="grid grid-cols-3 gap-5 mb-6">
          {accounts.map(a => (
            <div key={a.type} className={`rounded-xl border ${a.color}`}>
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center gap-2 mb-4"><div className={`w-2 h-2 rounded-full ${a.dot}`} /><p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{a.type}</p></div>
                <p className="font-semibold text-slate-800 mb-1">{a.name}</p>
                <p className="text-xs text-slate-400 font-mono mb-4">{a.id}</p>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">{a.label}</p>
                <p className="text-2xl font-bold font-mono text-slate-900">{fmt(a.balance)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4 flex items-center justify-between">
          <div><p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Total Platform Value</p><p className="text-xs text-slate-400 mt-0.5">Conserved across all transactions</p></div>
          <p className="text-2xl font-bold font-mono text-slate-900">{fmt(accounts.reduce((s, a) => s + a.balance, 0))}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Create Escrow Modal ──────────────────────────────────────────────────────

interface MilestoneForm { id: string; title: string; amount: string; description: string }

// domain / releaseModel are purely cosmetic UI concepts — the backend's
// createEscrow only accepts { title, description, clientId, freelancerId,
// totalAmount } (see SecureLance/src/services/escrowService.js), so these
// two fields are never sent to the API. The parent keeps them in local
// session state, keyed by the real escrow id, purely for display.
function CreateEscrowModal({ open, onClose, onCreated, clientId, freelancerUsers }: {
  open: boolean; onClose: () => void
  onCreated: (escrowId: string, meta: { domain: string; releaseModel: ReleaseModel }) => void
  clientId: string; freelancerUsers: BackendUser[]
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    freelancerId: "",
    domain: "Freelancing",
    releaseModel: "Milestone Based" as ReleaseModel,
  })
  const [milestones, setMilestones] = useState<MilestoneForm[]>([{ id: genId(), title: "", amount: "", description: "" }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const updateM = (id: string, k: keyof MilestoneForm, v: string) => setMilestones(m => m.map(x => x.id === id ? { ...x, [k]: v } : x))
  const totalAmount = milestones.reduce((s, m) => s + (parseFloat(m.amount) || 0), 0)
  const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-400"

  useEffect(() => {
    if (open && !form.freelancerId && freelancerUsers.length > 0) setF("freelancerId", freelancerUsers[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, freelancerUsers])

  const resetForm = () => {
    setForm({
      title: "",
      description: "",
      freelancerId: freelancerUsers[0]?.id ?? "",
      domain: "Freelancing",
      releaseModel: "Milestone Based",
    })
    setMilestones([{ id: genId(), title: "", amount: "", description: "" }])
    setError(null)
  }

  const handleClose = () => { if (!submitting) { resetForm(); onClose() } }

  const handleSubmit = async () => {
    if (!form.freelancerId) { setError("Select a provider for this escrow."); return }
    if (milestones.some(m => !Number.isFinite(parseFloat(m.amount)) || parseFloat(m.amount) <= 0)) { setError("Every milestone must have an amount greater than 0."); return }
    if (totalAmount <= 0) { setError("Add at least one milestone with an amount greater than 0."); return }
    setSubmitting(true)
    setError(null)
    try {
      // Create the escrow on the real backend first…
      const escrow = await api.createEscrow({
        title: form.title || "New Escrow",
        description: form.description,
        clientId,
        freelancerId: form.freelancerId,
        totalAmount,
      })
      // …then create each milestone against the real escrow ID returned above.
      for (const m of milestones) {
        await api.createMilestone(escrow.id, {
          title: m.title || "Milestone",
          description: m.description,
          amount: parseFloat(m.amount) || 0,
        })
      }
      // Domain and release model are currently UI metadata.
      // The backend financial workflow remains milestone-based.
      const meta = {
        domain: form.domain,
        releaseModel: form.releaseModel,
      }
      resetForm()
      onClose()
      onCreated(escrow.id, meta)
    } catch (err) {
      setError(extractApiErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} wide>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div><h2 className="font-bold text-slate-900">Create Escrow</h2><p className="text-xs text-slate-400 mt-0.5">Configure a new escrow agreement</p></div>
        <button onClick={handleClose} className="text-slate-400 hover:text-slate-600"><XIcon /></button>
      </div>
      <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
            <span className="mt-0.5 font-bold">!</span><span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1.5">Escrow Title</label><input className={inputCls} placeholder="e.g. Website Development" value={form.title} onChange={e => setF("title", e.target.value)} /></div>
          <div className="col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1.5">Description</label><textarea className={`${inputCls} resize-none`} rows={2} value={form.description} onChange={e => setF("description", e.target.value)} /></div>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Domain</label>
              <select
                className={inputCls}
                value={form.domain}
                onChange={e => setF("domain", e.target.value)}
              >
                <option value="Freelancing">Freelancing</option>
                <option value="Rentals">Rentals</option>
                <option value="Marketplace">Marketplace</option>
                <option value="B2B Services">B2B Services</option>
                <option value="Digital Services">Digital Services</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Release Model</label>
              <select
                className={inputCls}
                value={form.releaseModel}
                onChange={e => setF("releaseModel", e.target.value)}
              >
                <option value="Milestone Based">Milestone Based</option>
                <option value="Condition Based">Condition Based</option>
              </select>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-5">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Provider</p>
          <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Provider</label>
            <select className={inputCls} value={form.freelancerId} onChange={e => setF("freelancerId", e.target.value)}>
              {freelancerUsers.length === 0 && <option value="">No providers available</option>}
              {freelancerUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
            </select>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between mb-3">
            <div><p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Milestones</p>{totalAmount > 0 && <p className="text-xs text-slate-400 mt-0.5">Total: <span className="font-mono font-medium text-slate-700">{fmt(totalAmount)}</span></p>}</div>
            <Btn variant="outline" size="sm" onClick={() => setMilestones(m => [...m, { id: genId(), title: "", amount: "", description: "" }])}><PlusIcon size={12} /> Add Milestone</Btn>
          </div>
          <div className="space-y-3">
            {milestones.map((m, i) => (
              <div key={m.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-slate-500">Milestone {i + 1}</p>
                  {milestones.length > 1 && <button onClick={() => setMilestones(ms => ms.filter(x => x.id !== m.id))} className="text-slate-400 hover:text-red-500 transition-colors"><TrashIcon /></button>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Title</label><input className={inputCls} placeholder="e.g. Design Phase" value={m.title} onChange={e => updateM(m.id, "title", e.target.value)} /></div>
                  <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Amount (₹)</label><input className={`${inputCls} font-mono`} type="number" placeholder="0" value={m.amount} onChange={e => updateM(m.id, "amount", e.target.value)} /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label><input className={inputCls} placeholder="What does this milestone cover?" value={m.description} onChange={e => updateM(m.id, "description", e.target.value)} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs text-blue-700">
          <span className="mt-0.5 font-bold">ℹ</span>
          <span>Funds are held securely and released after milestone approval.</span>
        </div>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
        {totalAmount > 0 && <p className="text-sm text-slate-500">Total: <span className="font-mono font-semibold text-slate-900">{fmt(totalAmount)}</span></p>}
        <div className="flex gap-2 ml-auto">
          <Btn variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Btn>
          <Btn onClick={handleSubmit} loading={submitting}>Create Escrow</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Release Payment Modal ────────────────────────────────────────────────────

function ReleasePaymentModal({ open, onClose, onConfirm, loading, success, milestone, providerName }: {
  open: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; success: boolean
  milestone: Milestone | null; providerName: string
}) {
  if (!milestone) return null
  return (
    <Modal open={open} onClose={!loading ? onClose : () => {}}>
      {success ? (
        <div className="px-8 py-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5 text-emerald-600"><CheckIcon size={28} /></div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Payment Released Successfully</h2>
          <p className="text-3xl font-bold font-mono text-emerald-600 mb-1">{fmt(milestone.amount)}</p>
          <p className="text-sm text-slate-500 mb-6">Escrow → {providerName}</p>
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-5 py-4 text-left mb-6 space-y-2">
            {["Transaction completed", "Ledger updated", "Escrow closed"].map(s => (
              <div key={s} className="flex items-center gap-2 text-sm text-slate-700">
                <div className="w-4 h-4 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600"><CheckIcon size={8} /></div>
                {s}
              </div>
            ))}
          </div>
          <Btn onClick={onClose} className="w-full justify-center">Done</Btn>
        </div>
      ) : (
        <>
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Release Payment?</h2>
            {!loading && <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><XIcon /></button>}
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600">You are about to release <span className="font-semibold font-mono text-slate-900">{fmt(milestone.amount)}</span> from the escrow account to the provider.</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              {[["From", "Escrow Account", shortId(milestone.id)], ["To", providerName, "Provider account"], ["Amount", fmt(milestone.amount), "Full milestone amount"]].map(([l, v, s]) => (
                <div key={l} className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 last:border-0">
                  <p className="text-xs text-slate-400 font-medium">{l}</p>
                  <div className="text-right"><p className="text-sm font-semibold text-slate-800">{v}</p><p className="text-xs text-slate-400 font-mono">{s}</p></div>
                </div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">This action is irreversible for this milestone. Other milestones in the same escrow remain independent.</div>
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <Btn variant="secondary" onClick={onClose} disabled={loading}>Cancel</Btn>
            <Btn onClick={onConfirm} loading={loading}>Confirm Release</Btn>
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ─── Backend-sourced state ──────────────────────────────────────────────
  const [users, setUsers] = useState<BackendUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)

  const [rawEscrows, setRawEscrows] = useState<api.EscrowWithMilestones[]>([])
  const [clientAccount, setClientAccount] = useState<BackendAccount | null>(null)
  const [freelancerAccount, setFreelancerAccount] = useState<BackendAccount | null>(null)
  const [escrowAccount, setEscrowAccount] = useState<BackendAccount | null>(null)
  const [rawTransactions, setRawTransactions] = useState<BackendTransaction[]>([])
  const [rawLedgerEntries, setRawLedgerEntries] = useState<BackendLedgerEntry[]>([])
  const [ledgerSummary, setLedgerSummary] = useState<{ totalDebits: number; totalCredits: number; balanced: boolean; transactionsValidated: number } | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)

  // domain / releaseModel are cosmetic-only (see CreateEscrowModal comment);
  // kept in local session state, keyed by real backend escrow id.
  const [escrowMeta, setEscrowMeta] = useState<Record<string, { domain: string; releaseModel: ReleaseModel }>>({})

  // ─── UI-only state ──────────────────────────────────────────────────────
  const [currentRole, setCurrentRole] = useState<Role | null>(null)
  const [page, setPage] = useState<Page>("dashboard")
  const [selectedEscrowId, setSelectedEscrowId] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [releaseModal, setReleaseModal] = useState<{ milestoneId: string; escrowId: string } | null>(null)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [releaseSuccess, setReleaseSuccess] = useState(false)

  const clientUser = users.find(u => u.type === "CLIENT")
  const freelancerUser = users.find(u => u.type === "FREELANCER")
  const userName = useCallback((id: string) => users.find(u => u.id === id)?.name ?? id, [users])
  const accountLabel = useCallback((accountId: string) => {
    if (accountId === clientAccount?.id) return `${clientUser?.name ?? "Client"} Account`
    if (accountId === freelancerAccount?.id) return `${freelancerUser?.name ?? "Freelancer"} Account`
    if (accountId === escrowAccount?.id || accountId === api.ESCROW_ACCOUNT_ID) return "Escrow Account"
    return accountId
  }, [clientAccount, freelancerAccount, escrowAccount, clientUser, freelancerUser])

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = genId()
    setToasts(prev => [...prev, { ...t, id }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000)
  }, [])
  const dismissToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  // ─── Load real backend users (drives the Account Selection page) ───────
  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      setUsers(await api.getUsers())
    } catch (err) {
      setUsersError(extractApiErrorMessage(err))
    } finally {
      setUsersLoading(false)
    }
  }, [])
  useEffect(() => { loadUsers() }, [loadUsers])

  // ─── Refresh escrows + accounts + transactions + ledger from the backend.
  // Called on login and after every state-changing action, per the "Data
  // Refresh Strategy" — the backend stays the single source of truth. ───
  const refreshAll = useCallback(async () => {
    if (!clientUser || !freelancerUser) return
    setDataLoading(true)
    setDataError(null)
    try {
      const [escrowsWithMilestones, clientAcc, freelancerAcc, escrowAcc, validation] = await Promise.all([
        api.getAllEscrowsWithMilestones(),
        api.getAccountByUserId(clientUser.id),
        api.getAccountByUserId(freelancerUser.id),
        api.getAccountById(api.ESCROW_ACCOUNT_ID),
        api.validateLedger(),
      ])
      setRawEscrows(escrowsWithMilestones)
      setClientAccount(clientAcc)
      setFreelancerAccount(freelancerAcc)
      setEscrowAccount(escrowAcc)
      setLedgerSummary({
        totalDebits: validation.results.reduce((s, r) => s + r.totalDebits, 0),
        totalCredits: validation.results.reduce((s, r) => s + r.totalCredits, 0),
        balanced: validation.allBalanced,
        transactionsValidated: validation.totalTransactions,
      })

      const txns = await api.getAllTransactionsForEscrows(escrowsWithMilestones.map(e => e.id))
      setRawTransactions(txns)
      setRawLedgerEntries(await api.getAllLedgerEntriesForTransactions(txns.map(t => t.id)))
    } catch (err) {
      setDataError(extractApiErrorMessage(err))
    } finally {
      setDataLoading(false)
    }
  }, [clientUser, freelancerUser])

  useEffect(() => {
    if (currentRole) refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole])

  // ─── Derived, display-ready data (mapped from real backend shapes) ─────
  const escrows: Escrow[] = rawEscrows.map(e => {
    const milestones: Milestone[] = e.milestones.map(m => ({
      id: m.id, title: m.title, amount: m.amount, description: m.description, state: m.status, order: m.order,
    }))
    const meta = escrowMeta[e.id] ?? { domain: "Freelancing", releaseModel: "Milestone Based" as ReleaseModel }
    return {
      id: e.id, title: e.title, description: e.description, domain: meta.domain,
      providerName: userName(e.freelancerId), providerId: e.freelancerId, clientId: e.clientId,
      totalAmount: e.totalAmount, releaseModel: meta.releaseModel,
      state: deriveEscrowState(milestones), milestones, createdAt: fmtTime(e.createdAt),
    }
  })

  const transactions: Transaction[] = rawTransactions.map(t => ({
    id: t.id, type: t.type, escrowId: t.escrowId,
    escrowTitle: rawEscrows.find(e => e.id === t.escrowId)?.title ?? t.escrowId,
    milestoneId: t.milestoneId ?? "", amount: t.amount,
    from: accountLabel(t.fromAccountId), to: accountLabel(t.toAccountId),
    fromAccountId: t.fromAccountId, toAccountId: t.toAccountId,
    status: t.status, timestamp: fmtTime(t.createdAt),
  }))

  const ledger: LedgerEntry[] = rawLedgerEntries.map(entry => ({
    txId: entry.transactionId,
    txType: rawTransactions.find(t => t.id === entry.transactionId)?.type ?? "FUND",
    account: accountLabel(entry.accountId), entryType: entry.type, amount: entry.amount, balance: entry.balance,
  }))

  const selectedEscrow = escrows.find(e => e.id === selectedEscrowId) ?? escrows[0]

  // Default the selected escrow once data arrives.
  useEffect(() => {
    if (!selectedEscrowId && escrows.length > 0) setSelectedEscrowId(escrows[0].id)
  }, [escrows, selectedEscrowId])

  // ─── Actions — every one calls the real backend, then refreshes ────────
  const handleAction = useCallback(async (action: string, milestoneId: string) => {
    const escrow = rawEscrows.find(e => e.milestones.some(m => m.id === milestoneId))
    if (!escrow) return
    if (action === "RELEASE") { setReleaseModal({ milestoneId, escrowId: escrow.id }); return }

    const key = `${milestoneId}-${action}`
    setLoadingAction(key)
    try {
      switch (action) {
        case "FUND": await api.fundMilestone(escrow.id, milestoneId); break
        case "START": await api.startMilestone(escrow.id, milestoneId); break
        case "SUBMIT": await api.submitMilestone(milestoneId); break
        case "REVIEW": await api.reviewMilestone(milestoneId); break
        case "APPROVE": await api.approveMilestone(milestoneId); break
        default: return
      }
      const titles: Record<string, string> = {
        FUND: "Milestone funded — provider can now start work.",
        START: "Work started — milestone is now in progress.",
        SUBMIT: "Work submitted for review.",
        REVIEW: "Review started — milestone is under review.",
        APPROVE: "Milestone approved — ready for payment release.",
      }
      addToast({ type: "success", title: titles[action] ?? "Milestone updated." })
      await refreshAll()
    } catch (err) {
      addToast({ type: "error", title: "Action failed", message: extractApiErrorMessage(err) })
    } finally {
      setLoadingAction(null)
    }
  }, [rawEscrows, addToast, refreshAll])

  const handleConfirmRelease = useCallback(async () => {
    if (!releaseModal) return
    setReleaseLoading(true)
    try {
      await api.releaseMilestone(releaseModal.milestoneId)
      setReleaseLoading(false)
      setReleaseSuccess(true)
      await refreshAll()
    } catch (err) {
      setReleaseLoading(false)
      setReleaseModal(null)
      addToast({ type: "error", title: "Release failed", message: extractApiErrorMessage(err) })
    }
  }, [releaseModal, refreshAll, addToast])

  const handleCloseRelease = useCallback(() => {
    if (releaseLoading) return
    if (releaseSuccess) addToast({ type: "success", title: "Payment released successfully", message: "Ledger has been updated." })
    setReleaseModal(null)
    setReleaseSuccess(false)
  }, [releaseLoading, releaseSuccess, addToast])

  const handleEscrowCreated = useCallback(async (escrowId: string, meta: { domain: string; releaseModel: ReleaseModel }) => {
    setEscrowMeta(prev => ({ ...prev, [escrowId]: meta }))
    addToast({ type: "success", title: "Escrow created", message: "It's ready to be funded." })
    await refreshAll()
    setSelectedEscrowId(escrowId)
    setPage("escrow")
  }, [refreshAll, addToast])

  const navigateToEscrow = useCallback((id: string) => {
    setSelectedEscrowId(id)
    setPage("escrow")
  }, [])

  const handleSwitch = useCallback(() => {
    setCurrentRole(null)
    setPage("dashboard")
    setSelectedEscrowId(null)
  }, [])

  const releaseMilestone = releaseModal
    ? escrows.find(e => e.id === releaseModal.escrowId)?.milestones.find(m => m.id === releaseModal.milestoneId) ?? null
    : null
  const releaseEscrow = releaseModal ? escrows.find(e => e.id === releaseModal.escrowId) : null

  // ─── Account selection (uses real backend users) ────────────────────────
  if (!currentRole) {
    return (
      <AccountSelectionPage
        users={users} loading={usersLoading} error={usersError} onRetry={loadUsers}
        onSelect={role => { setCurrentRole(role); setPage("dashboard") }}
      />
    )
  }

  const user = (currentRole === "CLIENT" ? clientUser : freelancerUser) ?? { id: "", name: currentRole === "CLIENT" ? "Client" : "Freelancer", type: currentRole, createdAt: 0 }

  if (dataError && rawEscrows.length === 0 && !dataLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4"><XIcon size={22} /></div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Can't reach the backend</h1>
        <p className="text-slate-500 text-sm max-w-sm mb-6">{dataError}</p>
        <Btn onClick={refreshAll}>Retry</Btn>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar page={page} setPage={setPage} role={currentRole} user={user} onSwitch={handleSwitch} />

      {dataLoading && rawEscrows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <SpinnerIcon />
          <p className="text-slate-400 text-sm mt-3">Loading escrow data…</p>
        </div>
      ) : (
        <>
          {page === "dashboard" && (
            <DashboardPage
              escrows={escrows} transactions={transactions} role={currentRole} user={user}
              clientName={clientUser?.name ?? "Test Client"}
              clientBalance={clientAccount?.balance ?? 0} freelancerBalance={freelancerAccount?.balance ?? 0}
              setPage={setPage} setSelectedEscrowId={navigateToEscrow}
              onCreateEscrow={() => setShowCreateModal(true)}
            />
          )}
          {page === "escrow" && selectedEscrow ? (
            <EscrowDetailsPage
              escrow={selectedEscrow} role={currentRole} clientName={clientUser?.name ?? "Test Client"}
              onAction={handleAction} loadingAction={loadingAction}
              onBack={() => setPage("escrow")}
            />
          ) : page === "escrow" ? (
            <EscrowListPage escrows={escrows} role={currentRole} clientName={clientUser?.name ?? "Test Client"} setSelectedEscrowId={navigateToEscrow} onCreateEscrow={() => setShowCreateModal(true)} />
          ) : null}
          {page === "transactions" && (
            <TransactionsPage
              transactions={transactions}
              currentAccountId={currentRole === "CLIENT" ? (clientAccount?.id ?? "") : (freelancerAccount?.id ?? "")}
              onViewLedger={() => setPage("ledger")}
            />
          )}
          {page === "ledger" && <LedgerPage entries={ledger} summary={ledgerSummary} />}
          {page === "accounts" && (
            <AccountsPage
              currentAccountId={currentRole === "CLIENT" ? (clientAccount?.id ?? "") : (freelancerAccount?.id ?? "")}
              clientAccount={clientAccount} freelancerAccount={freelancerAccount} escrowAccount={escrowAccount}
              clientName={clientUser?.name ?? "Test Client"} freelancerName={freelancerUser?.name ?? "Test Freelancer"}
            />
          )}
        </>
      )}

      <CreateEscrowModal
        open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={handleEscrowCreated}
        clientId={clientUser?.id ?? "user-1"} freelancerUsers={freelancerUser ? [freelancerUser] : []}
      />
      <ReleasePaymentModal
        open={!!releaseModal} onClose={handleCloseRelease}
        onConfirm={handleConfirmRelease} loading={releaseLoading} success={releaseSuccess}
        milestone={releaseMilestone} providerName={releaseEscrow?.providerName ?? ""}
      />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}