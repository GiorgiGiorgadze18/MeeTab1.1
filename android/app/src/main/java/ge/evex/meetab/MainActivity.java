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
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

/** Fully bundled MeeTab web UI. Sign-in opens Android's external default browser. */
public class MainActivity extends Activity {
    private static final String BUNDLED_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final String PIN = "2580"; // Change before installing on a public tablet.
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
                if("meetab".equals(uri.getScheme())){handleUri(uri);return true;}
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
        if(getIntent()!=null&&"meetab".equals(getIntent().getScheme()))handleUri(getIntent().getData());
        load();
    }
    private void openBrowser(Uri uri){
        try{Intent open=new Intent(Intent.ACTION_VIEW,uri);open.addCategory(Intent.CATEGORY_BROWSABLE);startActivity(open);}
        catch(Exception ex){new AlertDialog.Builder(this).setMessage("საჭიროა ბრაუზერი ავტორიზაციისთვის").setPositiveButton("OK",null).show();}
    }
    private void handleUri(Uri uri){
        if(uri==null||!"meetab".equals(uri.getScheme())||!"auth".equals(uri.getHost()))return;
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
    private void askPin(){
        final EditText field=new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        field.setHint("PIN");
        new AlertDialog.Builder(this).setTitle("MeeTab Admin").setView(field)
            .setPositiveButton("OK",(d,w)->{if(PIN.equals(field.getText().toString()))showSettings();})
            .setNegativeButton("Cancel",null).show();
    }
    private void showSettings(){
        final EditText url=new EditText(this);
        url.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        url.setText(prefs.getString("url",BUNDLED_URL));
        new AlertDialog.Builder(this).setTitle("Page URL (bundled or hosted)").setView(url)
            .setPositiveButton("Save",(d,w)->{String value=url.getText().toString().trim();if(value.startsWith("https://")){prefs.edit().putString("url",value).apply();load();}})
            .setNeutralButton("Wi-Fi",(d,w)->startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)))
            .setNegativeButton("Close",null).show();
    }
    private int dp(int x){return (int)(x*getResources().getDisplayMetrics().density);}
    @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleUri(intent.getData());}
    @Override public void onBackPressed(){/* Kiosk: no accidental back navigation. */}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_FULLSCREEN|
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);if(web!=null)web.destroy();super.onDestroy();}
}
