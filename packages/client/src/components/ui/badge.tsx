import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        secondary: "border-border bg-secondary text-muted-foreground",
        destructive: "border-transparent bg-danger/15 text-danger",
        outline: "border-border text-muted-foreground",
        // Metadata chips (format, ISO, focal length, aperture) stay monochrome —
        // amber is reserved for things that actually want attention.
        blue: "border-border bg-secondary text-foreground",
        purple: "border-border bg-secondary text-foreground",
        green: "border-transparent bg-success/15 text-success",
        orange: "border-transparent bg-warning/15 text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
