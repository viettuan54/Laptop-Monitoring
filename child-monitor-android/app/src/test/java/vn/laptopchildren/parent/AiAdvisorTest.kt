package vn.laptopchildren.parent

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import vn.laptopchildren.parent.data.*
import java.io.IOException

private class AdvisorApi : ParentApi by createApi("http://localhost/", MemorySession()) {
    var history: suspend (Long, Int) -> Page<AiAnalysis> = { _, _ -> Page() }
    var report: suspend (Long, String) -> AiSummary = { id, period -> AiSummary(id, period, "Báo cáo") }
    var run: suspend (Long) -> Message = { Message() }
    var answer: suspend (ChatRequest) -> ChatReply = { ChatReply("Trả lời") }
    override suspend fun analyses(device: Long, limit: Int, offset: Int) = history(device, offset)
    override suspend fun summary(device: Long, period: String) = report(device, period)
    override suspend fun analyze(device: Long) = run(device)
    override suspend fun chat(body: ChatRequest) = answer(body)
}

@OptIn(ExperimentalCoroutinesApi::class)
class AiAdvisorTest {
    private fun row(id: Long, device: Long = 1) = AiAnalysis(id, device, "Học tập", "low", "Gợi ý", "2026-11-10T00:00:00Z")

    @Test fun switchingDeviceDiscardsLateHistoryAndSummary() = runTest {
        val api = AdvisorApi()
        val oldHistory = CompletableDeferred<Page<AiAnalysis>>()
        api.history = { device, _ -> if (device == 1L) withContext(NonCancellable) { oldHistory.await() } else Page(listOf(row(2, device))) }
        val advisor = AiAdvisor({ api }, this, { 1 }, { throw AssertionError(it) })
        advisor.bindDevice(1); runCurrent()
        advisor.bindDevice(2); runCurrent()
        oldHistory.complete(Page(listOf(row(1))))
        advanceUntilIdle()
        assertEquals(2L, advisor.state.history.single().device_id)
        val oldSummary = CompletableDeferred<AiSummary>()
        api.report = { _, _ -> withContext(NonCancellable) { oldSummary.await() } }
        advisor.result("weekly"); runCurrent()
        advisor.bindDevice(3); runCurrent()
        oldSummary.complete(AiSummary(2, "weekly", "Cũ")); advanceUntilIdle()
        assertNull(advisor.state.summary)
        assertEquals(3L, advisor.state.deviceId)
    }

    @Test fun analysisSuccessThenHistoryFailureDoesNotPretendPostFailed() = runTest {
        val api = AdvisorApi()
        val advisor = AiAdvisor({ api }, this, { 1 }, {})
        advisor.bindDevice(1); advanceUntilIdle()
        var posts = 0
        api.run = { posts++; Message() }
        api.history = { _, _ -> throw IOException("offline") }
        advisor.result("analysis"); advanceUntilIdle()
        assertTrue(advisor.state.resultError!!.contains("đã hoàn thành"))
        assertEquals(1, posts)
        advisor.refreshHistory(); advanceUntilIdle()
        assertEquals(1, posts)
    }

    @Test fun uncertainPostIsNotAutomaticallyResubmitted() = runTest {
        val api = AdvisorApi()
        var posts = 0
        api.run = { posts++; throw IOException("timeout") }
        val advisor = AiAdvisor({ api }, this, { 1 }, {})
        advisor.bindDevice(1); advanceUntilIdle()
        advisor.result("analysis"); advisor.result("analysis"); advanceUntilIdle()
        assertEquals(1, posts)
        assertTrue(advisor.state.resultError!!.startsWith("Chưa xác nhận"))
        assertNull(advisor.state.task)
    }

    @Test fun chatFailureKeepsDraftAndRetryAddsOnlyOnePair() = runTest {
        val api = AdvisorApi()
        api.answer = { throw IOException("offline") }
        val advisor = AiAdvisor({ api }, this, { 1 }, {})
        advisor.draft("Câu hỏi"); advisor.send(); advanceUntilIdle()
        assertEquals("Câu hỏi", advisor.state.draft)
        assertTrue(advisor.state.messages.isEmpty())
        api.answer = { ChatReply("Trả lời") }
        advisor.send(); advisor.send(); advanceUntilIdle()
        assertEquals(listOf("user", "model"), advisor.state.messages.map { it.role })
        assertEquals("", advisor.state.draft)
        assertNull(advisor.state.chatError)
    }

    @Test fun chatContextUsesCompleteBoundedPairsAndTruncatesLongRepliesOnlyOnWire() = runTest {
        val api = AdvisorApi()
        val requests = mutableListOf<ChatRequest>()
        api.answer = { requests += it; ChatReply("a".repeat(2500)) }
        val advisor = AiAdvisor({ api }, this, { 1 }, {})
        repeat(12) { advisor.draft("Câu $it"); advisor.send(); advanceUntilIdle() }
        val context = requests.last().messages
        assertEquals(19, context.size)
        assertEquals("user", context.first().role)
        assertTrue(context.all { it.content.length <= 2000 })
        assertEquals(2500, advisor.state.messages.last().content.length)
    }

    @Test fun resetPreventsOldChatResponseFromReturningAfterLogout() = runTest {
        val api = AdvisorApi()
        val deferred = CompletableDeferred<ChatReply>()
        api.answer = { withContext(NonCancellable) { deferred.await() } }
        val advisor = AiAdvisor({ api }, this, { 1 }, {})
        advisor.draft("Riêng tư"); advisor.send(); runCurrent()
        advisor.reset(); deferred.complete(ChatReply("Cũ")); advanceUntilIdle()
        assertEquals(AdvisorState(), advisor.state)
    }

    @Test fun expiredSessionStillNotifiesParentAfterRefreshChangesGeneration() = runTest {
        val api = AdvisorApi()
        var generation = 1L
        var expired = false
        lateinit var advisor: AiAdvisor
        advisor = AiAdvisor({ api }, this, { generation }, { expired = true; advisor.reset() })
        api.history = { _, _ -> generation++; throw HttpException(Response.error<Any>(401, "{}".toResponseBody())) }
        advisor.bindDevice(1); advanceUntilIdle()
        assertTrue(expired)
        assertEquals(AdvisorState(), advisor.state)
    }

    @Test fun paginationAppendsAndRefreshResetsOffset() = runTest {
        val api = AdvisorApi()
        val offsets = mutableListOf<Int>()
        api.history = { device, offset -> offsets += offset; Page((offset + 1L..offset + 20L).map { row(it, device) }) }
        val advisor = AiAdvisor({ api }, this, { 1 }, {})
        advisor.bindDevice(1); advanceUntilIdle()
        advisor.refreshHistory(true); advanceUntilIdle()
        assertEquals(40, advisor.state.history.size)
        advisor.refreshHistory(); advanceUntilIdle()
        assertEquals(listOf(0, 20, 0), offsets)
        assertEquals(20, advisor.state.history.size)
    }
}
