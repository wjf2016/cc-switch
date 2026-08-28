import * as React from "react";

import { cn } from "@/lib/utils";

type CheckedState = boolean | "indeterminate";

interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "checked" | "type"
  > {
  checked?: CheckedState;
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      checked,
      onChange,
      onCheckedChange,
      "aria-checked": ariaChecked,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const isIndeterminate = checked === "indeterminate";

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    React.useLayoutEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = isIndeterminate;
      }
    });

    return (
      <input
        {...props}
        ref={inputRef}
        type="checkbox"
        checked={isIndeterminate ? false : checked}
        aria-checked={isIndeterminate ? "mixed" : ariaChecked}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
        className={cn(
          "w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded outline-none focus:outline-none focus-visible:outline-none active:outline-none focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 focus-visible:ring-offset-0",
          className,
        )}
      />
    );
  },
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
export type { CheckboxProps, CheckedState };
