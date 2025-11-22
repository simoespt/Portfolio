import * as React from "react";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={`text-sm font-medium text-gray-800 ${className}`}
        {...props}
      />
    );
  }
);

Label.displayName = "Label";
