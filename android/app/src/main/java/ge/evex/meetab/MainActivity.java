package ge.evex.meetab;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;
import android.util.Base64;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

/** Fully bundled MeeTab web UI. Sign-in opens Android's external default browser. */
public class MainActivity extends Activity {
    private static final String BUNDLED_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final String ADMIN_SALT = "admin_salt_v2";
    private static final String ADMIN_HASH = "admin_hash_v2";
    private static final String ADMIN_FAILURES = "admin_failures_v2";
    private static final String ADMIN_LOCKED_UNTIL = "admin_locked_until_v2";
    private static final int ADMIN_ITERATIONS = 180000;
    // No default PIN; the owner creates a device-local passphrase at first launch.
    private WebView web;
    private SharedPreferences prefs;
    private Handler handler = new Handler();
    private boolean failed = false;
    private boolean loaded = false;
    private String pendingTicket = null;
    private WebViewAssetLoader assetLoader;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("meetab", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        FrameLayout layout = new FrameLayout(this);
        layout.setBackgroundColor(Color.parseColor("#FBFBFB"));
        web = new WebView(this);
        layout.addView(web, new FrameLayout.LayoutParams(-1, -1));
        View corner = new View(this);
        layout.addView(corner, new FrameLayout.LayoutParams(dp(78), dp(78), Gravity.TOP|Gravity.LEFT));
        corner.setOnLongClickListener(v->{askPin();return true;});
        setContentView(layout);

        WebSettings config=web.getSettings();
        config.setJavaScriptEnabled(true);
        config.setDomStorageEnabled(true);
        config.setMediaPlaybackRequiresUserGesture(false);
        config.setSupportZoom(false);
        config.setAllowFileAccess(false);
        config.setAllowContentAccess(false);
        config.setAllowFileAccessFromFileURLs(false);
        config.setAllowUniversalAccessFromFileURLs(false);
        config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest req){
                return assetLoader.shouldInterceptRequest(req.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest req){
                Uri uri=req.getUrl();
                if(BuildConfig.AUTH_SCHEME.equals(uri.getScheme())){handleUri(uri);return true;}
                if("https".equals(uri.getScheme())&&uri.getPath()!=null&&uri.getPath().matches("/auth/(google|microsoft)/start")){
                    openBrowser(uri);return true;
                }
                if("appassets.androidplatform.net".equals(uri.getHost()))return false;
                // Do not silently navigate away from the trusted bundled app.
                if("https".equals(uri.getScheme()))openBrowser(uri);
                return true;
            }
            @Override public void onReceivedError(WebView v,WebResourceRequest req,WebResourceError error){
                if(req.isForMainFrame())showOffline();
            }
            @Override public void onPageFinished(WebView v,String url){
                loaded=true;
                if(!failed){handler.removeCallbacks(retry);deliverTicket();}
            }
        });
        if(getIntent()!=null&&BuildConfig.AUTH_SCHEME.equals(getIntent().getScheme()))handleUri(getIntent().getData());
        load();
        if(!prefs.contains(ADMIN_HASH))enrollAdmin(false);
    }
    private void openBrowser(Uri uri){
        try{Intent open=new Intent(Intent.ACTION_VIEW,uri);open.addCategory(Intent.CATEGORY_BROWSABLE);startActivity(open);}
        catch(Exception ex){new AlertDialog.Builder(this).setMessage("საჭიროა ბრაუზერი ავტორიზაციისთვის").setPositiveButton("OK",null).show();}
    }
    private void handleUri(Uri uri){
        if(uri==null||!BuildConfig.AUTH_SCHEME.equals(uri.getScheme())||!"auth".equals(uri.getHost()))return;
        String ticket=uri.getQueryParameter("ticket");
        if(ticket==null||!ticket.matches("[A-Za-z0-9_-]{30,100}"))return;
        pendingTicket=ticket;
        deliverTicket();
    }
    private void deliverTicket(){
        if(!loaded||pendingTicket==null||web==null)return;
        String t=pendingTicket;pendingTicket=null;
        web.evaluateJavascript("if(window.MeeTabReceiveTicket)window.MeeTabReceiveTicket("+JSONObject.quote(t)+");",null);
    }
    private Runnable retry=new Runnable(){@Override public void run(){load();}};
    private void load(){
        failed=false;loaded=false;
        String url=prefs.getString("url",BUNDLED_URL);
        if(!url.startsWith("https://"))url=BUNDLED_URL;
        web.loadUrl(url);
    }
    private void showOffline(){
        failed=true;
        // Reload bundled UI after network returns; no remote splash is needed for built-in assets.
        handler.removeCallbacks(retry);
        handler.postDelayed(retry,15000);
    }
    // Device-local admin passphrase is salted and stretched; never stored in plaintext
    // or embedded into the APK. Enroll during supervised tablet setup.
    private byte[] deriveAdminHash(String passphrase,byte[] salt) throws Exception {
        PBEKeySpec spec=new PBEKeySpec(passphrase.toCharArray(),salt,ADMIN_ITERATIONS,256);
        try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded();}
        finally{spec.clearPassword();}
    }
    private void saveAdminPassphrase(String passphrase){
        try{
            byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);
            byte[] digest=deriveAdminHash(passphrase,salt);
            prefs.edit()
                .putString(ADMIN_SALT,Base64.encodeToString(salt,Base64.NO_WRAP))
                .putString(ADMIN_HASH,Base64.encodeToString(digest,Base64.NO_WRAP))
                .putInt(ADMIN_FAILURES,0).putLong(ADMIN_LOCKED_UNTIL,0).apply();
        }catch(Exception ex){throw new IllegalStateException("Unable to initialize device admin access",ex);}
    }
    private boolean correctAdminPassphrase(String attempt){
        try{
            String salt=prefs.getString(ADMIN_SALT,null),hash=prefs.getString(ADMIN_HASH,null);
            if(salt==null||hash==null)return false;
            byte[] expected=Base64.decode(hash,Base64.DEFAULT);
            byte[] actual=deriveAdminHash(attempt,Base64.decode(salt,Base64.DEFAULT));
            return MessageDigest.isEqual(expected,actual);
        }catch(Exception ex){return false;}
    }
    private void enrollAdmin(boolean changing){
        final LinearLayout form=new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20),dp(8),dp(20),0);
        final EditText one=new EditText(this),two=new EditText(this);
        one.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        two.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        one.setHint("Admin passphrase (10+ characters)");
        two.setHint("Repeat passphrase");
        form.addView(one);form.addView(two);
        AlertDialog dlg=new AlertDialog.Builder(this)
            .setTitle(changing?"Change MeeTab device admin code":"Set up MeeTab device admin")
            .setMessage(changing?"Choose a new private device code.":"Set this up privately BEFORE placing the tablet in a public room.")
            .setView(form).setPositiveButton("Save",null)
            .setNegativeButton(changing?"Cancel":"Exit",(d,w)->{if(!changing)finish();})
            .create();
        dlg.setCancelable(changing);
        dlg.setOnShowListener(d->dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String a=one.getText().toString(),b=two.getText().toString();
            if(a.length()<10||a.length()>128||!a.equals(b)){
                two.setError("Use matching passphrases of 10-128 characters");return;
            }
            try{saveAdminPassphrase(a);Toast.makeText(this,"Device admin code saved",Toast.LENGTH_SHORT).show();dlg.dismiss();}
            catch(Exception ex){two.setError("Unable to save admin code");}
        }));
        dlg.show();
    }
    private void askPin(){
        if(!prefs.contains(ADMIN_HASH)){enrollAdmin(false);return;}
        long remaining=prefs.getLong(ADMIN_LOCKED_UNTIL,0)-System.currentTimeMillis();
        if(remaining>0){
            Toast.makeText(this,"Admin locked temporarily. Try again later.",Toast.LENGTH_LONG).show();return;
        }
        final EditText field=new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        field.setHint("MeeTab device admin passphrase");
        new AlertDialog.Builder(this).setTitle("MeeTab Admin").setView(field)
            .setPositiveButton("Unlock",(d,w)->{
                if(correctAdminPassphrase(field.getText().toString())){
                    prefs.edit().putInt(ADMIN_FAILURES,0).putLong(ADMIN_LOCKED_UNTIL,0).apply();
                    showSettings();
                }else{
                    int tries=prefs.getInt(ADMIN_FAILURES,0)+1;
                    SharedPreferences.Editor editor=prefs.edit().putInt(ADMIN_FAILURES,tries);
                    if(tries>=5)editor.putLong(ADMIN_LOCKED_UNTIL,System.currentTimeMillis()+5*60*1000L).putInt(ADMIN_FAILURES,0);
                    editor.apply();
                    Toast.makeText(this,tries>=5?"Admin locked for 5 minutes":"Incorrect device admin code",Toast.LENGTH_LONG).show();
                }
            }).setNegativeButton("Cancel",null).show();
    }
    private void showSettings(){
        final EditText url=new EditText(this);
        url.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        url.setText(prefs.getString("url",BUNDLED_URL));
        new AlertDialog.Builder(this).setTitle("Page URL (bundled or hosted)").setView(url)
            .setPositiveButton("Save",(d,w)->{String value=url.getText().toString().trim();if(value.startsWith("https://")){prefs.edit().putString("url",value).apply();load();}})
            .setNeutralButton("Wi-Fi",(d,w)->startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)))
            .setNegativeButton("Change code",(d,w)->enrollAdmin(true)).show();
    }
    private int dp(int x){return (int)(x*getResources().getDisplayMetrics().density);}
    @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleUri(intent.getData());}
    @Override public void onBackPressed(){/* Kiosk: no accidental back navigation. */}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_FULLSCREEN|
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);}
    @Override protected void onResume(){
        super.onResume();
        if(web!=null){
            web.onResume();
            // Android WebView may not fire visibilitychange/focus after kiosk resume.
            // Refresh calendar without reloading the page or losing the OAuth session.
            if(loaded)web.evaluateJavascript("if(window.MeeTabRefreshCalendar)window.MeeTabRefreshCalendar();",null);
        }
    }
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);if(web!=null)web.destroy();super.onDestroy();}
}
