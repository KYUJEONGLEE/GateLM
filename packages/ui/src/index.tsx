import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  return <button className={`g-button g-button--${variant} ${className}`.trim()} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`g-input ${className}`.trim()} {...props} />;
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`g-card ${className}`.trim()} {...props} />;
}

export function Badge({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`g-badge ${className}`.trim()} {...props} />;
}
