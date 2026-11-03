import { useI18n } from '@/i18n'

export function SelectCheckbox({
  checked, disabled, label, title, onToggle,
}: {
  checked: boolean
  disabled: boolean
  label: string
  title?: string
  onToggle: () => void
}) {
  return (
    <label
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center justify-center min-w-[44px] min-h-[44px] ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={label}
        className="h-5 w-5 rounded"
        style={{ accentColor: 'var(--accent)' }}
      />
    </label>
  )
}

export function TransferActionBar({
  count, canContinue, onSelectEligible, onContinue, onCancel,
}: {
  count: number
  canContinue: boolean
  onSelectEligible: () => void
  onContinue: () => void
  onCancel: () => void
}) {
  const { t, n } = useI18n()
  const stock = t.admin.stock

  return (
    <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[45] lg:inset-x-auto lg:bottom-6 lg:right-8 lg:w-[32rem]">
      <div className="bg-surface border border-line rounded-xl shadow-lg px-3 py-2.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink mr-auto">
          {stock.selectedCount.replace('{{count}}', n(String(count)))}
        </span>
        <button
          type="button"
          onClick={onSelectEligible}
          className="min-h-[44px] px-3 rounded-lg text-sm font-medium bg-surface border border-line text-ink hover:bg-app transition-colors"
        >
          {stock.selectEligible}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-3 rounded-lg text-sm font-medium bg-surface border border-line text-muted hover:bg-app transition-colors"
        >
          {stock.cancel}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-50 transition-opacity"
        >
          {stock.continueAction}
        </button>
      </div>
    </div>
  )
}
