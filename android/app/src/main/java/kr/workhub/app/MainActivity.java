package kr.workhub.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RecorderPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(GooglePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
