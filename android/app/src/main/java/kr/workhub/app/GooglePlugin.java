package kr.workhub.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

/**
 * 구글 드라이브 "앱 전용 숨김 폴더(appDataFolder)" 접근 토큰을 받는다.
 * 다른 드라이브 파일은 볼 수 없는 가장 좁은 권한(drive.appdata)만 요청한다.
 * 안드로이드용 OAuth 클라이언트(패키지 이름 + 서명 SHA-1 등록)가 구글 클라우드에 만들어져 있어야 동작한다.
 */
@CapacitorPlugin(name = "WorkhubGoogle", requestCodes = { GooglePlugin.REQ })
public class GooglePlugin extends Plugin {
    static final int REQ = 9301;
    private static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";

    /** interactive=false 면 이미 동의한 경우에만 조용히 토큰을 주고, 동의가 필요하면 NEED_CONSENT 로 거절한다. */
    @PluginMethod
    public void getToken(final PluginCall call) {
        final boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest req = AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).build();
        Identity.getAuthorizationClient(getActivity()).authorize(req)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) { resolveToken(call, result); return; }
                if (!interactive) { call.reject("구글 계정 연결이 필요합니다.", "NEED_CONSENT"); return; }
                try {
                    PendingIntent pi = result.getPendingIntent();
                    saveCall(call);
                    getActivity().startIntentSenderForResult(pi.getIntentSender(), REQ, null, 0, 0, 0);
                } catch (IntentSender.SendIntentException e) { call.reject("구글 연결 화면을 열지 못했습니다.", "AUTH"); }
            })
            .addOnFailureListener(e -> call.reject(messageOf(e), codeOf(e)));
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ) return;
        PluginCall call = getSavedCall();
        if (call == null) return;
        try {
            AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data);
            resolveToken(call, r);
        } catch (ApiException e) {
            call.reject(messageOf(e), codeOf(e));
        } catch (Exception e) {
            call.reject("연결을 취소했습니다.", "CANCELED");
        }
    }

    private void resolveToken(PluginCall call, AuthorizationResult r) {
        String t = r.getAccessToken();
        if (t == null) { call.reject("구글 접근 토큰을 받지 못했습니다.", "AUTH"); return; }
        JSObject o = new JSObject(); o.put("accessToken", t); call.resolve(o);
    }

    private static String codeOf(Exception e) {
        if (e instanceof ApiException) {
            int c = ((ApiException) e).getStatusCode();
            if (c == 10 || c == 12500) return "NOT_CONFIGURED";   // 개발자 설정(OAuth 클라이언트) 문제
            if (c == 16 || c == 12501) return "CANCELED";
            if (c == 7) return "NETWORK";
            if (c == 1 || c == 2 || c == 9) return "NO_PLAY_SERVICES";
        }
        return "AUTH";
    }
    private static String messageOf(Exception e) {
        String c = codeOf(e);
        if (c.equals("NOT_CONFIGURED")) return "구글 로그인 설정이 아직 완료되지 않았습니다. (개발자 설정 필요: " + e.getMessage() + ")";
        if (c.equals("CANCELED")) return "연결을 취소했습니다.";
        if (c.equals("NETWORK")) return "인터넷 연결을 확인해 주세요.";
        if (c.equals("NO_PLAY_SERVICES")) return "이 기기에서 Google Play 서비스를 사용할 수 없습니다.";
        return "구글 로그인에 실패했습니다: " + e.getMessage();
    }
}
