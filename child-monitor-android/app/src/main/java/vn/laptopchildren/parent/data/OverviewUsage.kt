package vn.laptopchildren.parent.data

import java.time.LocalDate
import java.time.YearMonth

/** Keep today's/monthly totals intact while providing seven consecutive chart days. */
suspend fun loadOverviewUsage(api: ParentApi, childId: Long, today: LocalDate): Usage {
    val month = YearMonth.from(today)
    val current = api.usage(childId, month.toString())
    val start = today.minusDays(6)
    val previous = if (YearMonth.from(start) != month) api.usage(childId, month.minusMonths(1).toString()).daily else emptyList()
    val byDate = (previous + current.daily).associateBy { it.date }
    return current.copy(daily = (0L..6L).map { offset ->
        val date = start.plusDays(offset).toString()
        byDate[date] ?: DayUsage(date, 0)
    })
}
