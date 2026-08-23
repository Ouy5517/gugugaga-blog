import { ArrowRight } from "@phosphor-icons/react";

export function ArrowLink({ children, onClick, href }) {
  if (href) return <a className="arrow-link" href={href} target="_blank" rel="noreferrer"><span>{children}</span><ArrowRight size={18} aria-hidden="true" /></a>;
  return <button className="arrow-link" type="button" onClick={onClick}><span>{children}</span><ArrowRight size={18} aria-hidden="true" /></button>;
}
