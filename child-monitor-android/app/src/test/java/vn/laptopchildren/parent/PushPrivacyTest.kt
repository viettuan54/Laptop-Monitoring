package vn.laptopchildren.parent

import org.junit.Assert.*
import org.junit.Test

class PushPrivacyTest {
    @Test fun onlyCurrentSignedInRegistrationCanDisplay() {
        assertTrue(acceptPush(true, 42, "42"))
        assertFalse(acceptPush(false, 42, "42"))
        assertFalse(acceptPush(true, 0, "0"))
        assertFalse(acceptPush(true, 43, "42"))
        assertFalse(acceptPush(true, 42, null))
        assertFalse(acceptPush(true, 42, "invalid"))
    }
}
