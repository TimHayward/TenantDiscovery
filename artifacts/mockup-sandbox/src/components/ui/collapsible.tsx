"use client"
// Diverged from artifacts/m365-dashboard/src/components/ui/collapsible.tsx.
// This copy has drifted from the dashboard version and was deliberately left
// unreconciled. See docs/ui-divergence.md for what differs and why.

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
