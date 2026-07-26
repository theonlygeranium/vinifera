package ai.edstratumlabs.vinifera;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AppIdentityUnitTest {

    @Test
    public void packageIdentityMatchesReleaseContract() {
        assertEquals(
                "ai.edstratumlabs.vinifera",
                AppIdentityUnitTest.class.getPackage().getName());
    }
}
