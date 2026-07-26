package ai.edstratumlabs.vinifera;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppIdentityInstrumentedTest {

    @Test
    public void applicationIdentityMatchesReleaseContract() {
        Context appContext =
                InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("ai.edstratumlabs.vinifera", appContext.getPackageName());
        assertEquals("Vinifera", appContext.getString(R.string.app_name));
        assertFalse((appContext.getApplicationInfo().flags
                & ApplicationInfo.FLAG_ALLOW_BACKUP) != 0);
    }
}
