import { CalendarIcon, ChevronDownIcon } from "lucide-react"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  fromParts,
  localZoneName,
  parseTimeValue,
  type TimeZoneMode,
  timeValue,
  toParts,
} from "@/lib/time"

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  weekday: "short",
})

/** Calendar days are plain local-midnight Dates; the zone is applied separately. */
function calendarDay(unix: number, tz: TimeZoneMode): Date {
  const p = toParts(unix, tz)
  return new Date(p.year, p.month, p.day)
}

type DateTimePickerProps = {
  /** Unix seconds. */
  value: number
  onChange: (unix: number) => void
  tz: TimeZoneMode
  onTzChange: (tz: TimeZoneMode) => void
  /** Selectable range, unix seconds. */
  min: number
  max: number
}

/**
 * Date (shadcn Calendar in a Popover) + time (seconds precision) + zone.
 * The value is a single instant, so flipping UTC/Local keeps the same moment
 * and just re-expresses it.
 */
export function DateTimePicker({
  value,
  onChange,
  tz,
  onTzChange,
  min,
  max,
}: DateTimePickerProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const parts = toParts(value, tz)
  const selected = calendarDay(value, tz)
  const minDay = calendarDay(min, tz)
  const maxDay = calendarDay(max, tz)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-date`}>Date</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                id={`${id}-date`}
                variant="outline"
                className="w-52 justify-between font-normal"
              />
            }
          >
            <span className="flex items-center gap-2">
              <CalendarIcon className="text-muted-foreground" />
              {dayFormatter.format(selected)}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              captionLayout="dropdown"
              startMonth={minDay}
              endMonth={maxDay}
              disabled={[{ before: minDay }, { after: maxDay }]}
              onSelect={(day) => {
                if (!day) return
                onChange(
                  fromParts(
                    {
                      ...parts,
                      year: day.getFullYear(),
                      month: day.getMonth(),
                      day: day.getDate(),
                    },
                    tz
                  )
                )
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-time`}>Time</Label>
        <Input
          id={`${id}-time`}
          type="time"
          step={1}
          value={timeValue(parts)}
          onChange={(e) => {
            const t = parseTimeValue(e.target.value)
            if (t) onChange(fromParts({ ...parts, ...t }, tz))
          }}
          className="w-32 appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs/relaxed font-medium select-none">Zone</span>
        <div className="flex" role="group" aria-label="Time zone">
          {(["utc", "local"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={tz === mode ? "secondary" : "outline"}
              aria-pressed={tz === mode}
              onClick={() => onTzChange(mode)}
              title={
                mode === "local"
                  ? localZoneName()
                  : "Coordinated Universal Time"
              }
              className="-ml-px first:ml-0"
            >
              {mode === "utc" ? "UTC" : "Local"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
