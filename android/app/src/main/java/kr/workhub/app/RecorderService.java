package kr.workhub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import java.io.File;

/**
 * 회의 녹음 포그라운드 서비스. 화면이 꺼지거나 다른 앱을 써도 계속 녹음한다.
 * 정해진 길이마다 "그 자체로 재생 가능한" m4a 파일로 잘라 files/rec/ 에 저장한다(저장 중인 파일은 .part).
 * 변환(Gemini)은 화면(웹뷰)이 맡고, 화면이 없을 때 만들어진 조각은 파일로 남아 있다가 앱을 열면 처리된다.
 */
public class RecorderService extends Service {
    public static final String ACTION_START = "kr.workhub.app.REC_START";
    public static final String ACTION_STOP = "kr.workhub.app.REC_STOP";
    static final String CH = "rec";
    static final int NID = 4201;
    static final String PREFS = "wh_rec";

    private MediaRecorder recorder;
    private File current;
    private final Handler h = new Handler(Looper.getMainLooper());
    private long segMs = 600000, startedAt;
    private PowerManager.WakeLock wake;
    private boolean running;

    public static File dir(Context c) { File d = new File(c.getFilesDir(), "rec"); if (!d.exists()) d.mkdirs(); return d; }
    public static boolean isRunning(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("running", false); }
    public static long startedAt(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE).getLong("startedAt", 0); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(act)) { finishAll(); return START_NOT_STICKY; }
        if (ACTION_START.equals(act) && !running) {
            segMs = Math.max(5, intent.getIntExtra("segmentSec", 600)) * 1000L;
            beginForeground();
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "workhub:rec");
            wake.acquire(8 * 60 * 60 * 1000L);
            running = true; startedAt = System.currentTimeMillis();
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("running", true).putLong("startedAt", startedAt).apply();
            if (!startSegment()) finishAll();
            else h.postDelayed(tick, 1000);
        }
        return START_NOT_STICKY;
    }

    private void beginForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CH, "회의 녹음", NotificationManager.IMPORTANCE_LOW));
        Notification n = buildNotification("회의 녹음 중");
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NID, n);
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        return b.setContentTitle("업무 워크벤치").setContentText(text).setSmallIcon(R.drawable.ic_stat_icon)
                .setOngoing(true).setContentIntent(pi).build();
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            long sec = (System.currentTimeMillis() - startedAt) / 1000;
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NID, buildNotification(String.format("회의 녹음 중 · %02d:%02d", sec / 60, sec % 60)));
            h.postDelayed(this, 5000);
        }
    };

    private final Runnable rotate = new Runnable() {
        @Override public void run() {
            if (!running) return;
            closeSegment();
            if (!startSegment()) finishAll();
        }
    };

    private boolean startSegment() {
        try {
            current = new File(dir(this), "rec_" + System.currentTimeMillis() + ".m4a.part");
            MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            r.setAudioSource(MediaRecorder.AudioSource.MIC);
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioChannels(1); r.setAudioSamplingRate(16000); r.setAudioEncodingBitRate(48000);
            r.setOutputFile(current.getAbsolutePath());
            r.prepare(); r.start();
            recorder = r;
            h.postDelayed(rotate, segMs);
            return true;
        } catch (Exception e) {
            if (recorder != null) { try { recorder.release(); } catch (Exception ignore) {} recorder = null; }
            return false;
        }
    }

    // 현재 조각을 마무리해 .part -> .m4a 로 확정한다
    private void closeSegment() {
        h.removeCallbacks(rotate);
        if (recorder == null) return;
        boolean good = true;
        try { recorder.stop(); } catch (Exception e) { good = false; }   // 너무 짧으면 stop()이 실패할 수 있음
        try { recorder.release(); } catch (Exception ignore) {}
        recorder = null;
        if (current != null && current.exists()) {
            if (good && current.length() > 2000) {
                File fin = new File(current.getParentFile(), current.getName().replace(".part", ""));
                if (!current.renameTo(fin)) current.delete();
            } else current.delete();
        }
        current = null;
    }

    private void finishAll() {
        running = false;
        h.removeCallbacksAndMessages(null);
        closeSegment();
        if (wake != null && wake.isHeld()) wake.release();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("running", false).apply();
        stopForeground(true);
        stopSelf();
    }

    @Override public void onTaskRemoved(Intent rootIntent) { /* 앱을 최근 목록에서 밀어도 녹음은 계속한다 */ }

    @Override public void onDestroy() {
        if (running) finishAll();
        super.onDestroy();
    }
}
