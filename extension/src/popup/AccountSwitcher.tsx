interface Props {
  accounts: string[];
  selected: string | null;
  onSelect: (email: string | null) => void;
  onAdd: () => void;
}

export default function AccountSwitcher({ accounts, selected, onSelect, onAdd }: Props) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-slate-800 border-b border-slate-700 overflow-x-auto">
      <button
        onClick={() => onSelect(null)}
        className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          selected === null
            ? "bg-indigo-600 text-white"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
        }`}
      >
        All
      </button>

      {accounts.map((email) => {
        const label = email.split("@")[0];
        const isSelected = selected === email;
        return (
          <button
            key={email}
            onClick={() => onSelect(email)}
            title={email}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors max-w-[120px] truncate ${
              isSelected
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
            }`}
          >
            {label}
          </button>
        );
      })}

      <button
        onClick={onAdd}
        title="Add Gmail account"
        className="flex-shrink-0 ml-auto w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-sm font-bold"
      >
        +
      </button>
    </div>
  );
}
