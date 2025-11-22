import * as React from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "secondary" | "ghost";
}

const baseClasses =
  "inline-flex items-center justify-center rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 disabled:opacity-50 disabled:pointer-events-none h-10 px-4 py-2";

const variants: Record<string, string> = {
  default: "bg-black text-white hover:bg-black/80",
  outline:
    "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  secondary:
    "bg-gray-900/5 text-gray-900 hover:bg-gray-900/10 border border-gray-200",
  ghost: "text-gray-700 hover:bg-gray-100",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", ...props }, ref) => {
    const v = variants[variant] ?? variants.default;
    return (
      <button
        ref={ref}
        className={`${baseClasses} ${v} ${className}`}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
