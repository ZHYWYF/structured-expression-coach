import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowUpRight, Plus } from "lucide-react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function PrimaryButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="button button-primary" type="button" {...props}>
      {children}
    </button>
  );
}

export function NewSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="new-session-button" type="button" onClick={onClick}>
      <Plus size={16} strokeWidth={1.8} />
      新建会话
    </button>
  );
}

export function ArrowLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button className="arrow-link" type="button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}

export function StatusDot({ tone = "green" }: { tone?: "green" | "amber" | "gray" }) {
  return <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />;
}
