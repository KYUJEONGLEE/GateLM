import { ChevronRight } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

type BreadcrumbItem = {
  href?: string
  label: string
}

function Breadcrumb({
  className,
  items,
}: {
  className?: string
  items: BreadcrumbItem[]
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("console-breadcrumb", className)}>
      {items.map((item, index) => {
        const isCurrent = index === items.length - 1

        return (
          <span
            className="console-breadcrumb-item"
            data-current={isCurrent}
            key={`${item.label}-${index}`}
          >
            {index > 0 ? <ChevronRight aria-hidden="true" size={12} /> : null}
            {item.href && !isCurrent ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current={isCurrent ? "page" : undefined}>{item.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export { Breadcrumb }
export type { BreadcrumbItem }
