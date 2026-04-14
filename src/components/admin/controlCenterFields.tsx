export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/65">
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D90429] ${props.className || ''}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D90429] ${props.className || ''}`}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-white/10 bg-[#0C1017] px-4 py-3 text-sm text-white outline-none focus:border-[#D90429] ${props.className || ''}`}
    />
  );
}

export function Card({
  title,
  description,
  children,
  action,
  className,
  headerClassName,
  titleClassName,
  descriptionClassName,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/10 bg-[#11141C]/85 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] md:p-6 ${
        className || ''
      }`}
    >
      <div className={`mb-5 flex flex-wrap items-start justify-between gap-4 ${headerClassName || ''}`}>
        <div>
          <h2
            className={`text-base font-black uppercase tracking-[0.22em] text-white md:text-lg ${
              titleClassName || ''
            }`}
          >
            {title}
          </h2>
          {description && (
            <p
              className={`mt-2 max-w-3xl text-sm leading-6 text-white/60 ${
                descriptionClassName || ''
              }`}
            >
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.2em] ${
        active
          ? 'bg-[#D90429] text-white'
          : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

export function StatTile({
  title,
  value,
  icon,
  subcopy,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subcopy?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
      <div className="flex items-center justify-between text-white/45">
        <span className="text-[11px] font-black uppercase tracking-[0.22em]">{title}</span>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      {subcopy && <div className="mt-2 text-xs leading-5 text-white/55">{subcopy}</div>}
    </div>
  );
}

export function PillButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] ${
        active
          ? 'bg-[#D90429] text-white'
          : 'border border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
