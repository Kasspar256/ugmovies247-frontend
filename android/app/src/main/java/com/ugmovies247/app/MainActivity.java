package com.ugmovies247.app;

import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

public class MainActivity extends BridgeActivity {
  private static final String OFFLINE_PAGE_URL = "file:///android_asset/public/offline.html";
  private static final String EMPTY_MANIFEST = "{\"version\":1,\"records\":[]}";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    requestWindowFeature(Window.FEATURE_NO_TITLE);
    super.onCreate(savedInstanceState);

    if (getActionBar() != null) {
      getActionBar().hide();
    }

    getWindow().setStatusBarColor(Color.BLACK);

    Bridge currentBridge = this.bridge;
    WebView webView = currentBridge.getWebView();

    webView.getSettings().setAllowFileAccess(true);
    webView.getSettings().setAllowFileAccessFromFileURLs(true);
    webView.addJavascriptInterface(new OfflineDownloadsBridge(), "UGOfflineDownloads");

    webView.setWebViewClient(new BridgeWebViewClient(currentBridge) {
      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame() && !isOnline()) {
          showOfflinePage(view);
          return;
        }

        super.onReceivedError(view, request, error);
      }

      @Override
      public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
        if (!isOnline()) {
          showOfflinePage(view);
          return;
        }

        super.onReceivedError(view, errorCode, description, failingUrl);
      }
    });

    if (!isOnline()) {
      webView.post(() -> showOfflinePage(webView));
    }
  }

  private void showOfflinePage(WebView view) {
    view.loadUrl(OFFLINE_PAGE_URL);
  }

  private boolean isOnline() {
    ConnectivityManager connectivityManager =
      (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);

    if (connectivityManager == null) return false;

    Network network = connectivityManager.getActiveNetwork();
    if (network == null) return false;

    NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
    return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
  }

  private String readTextFile(File file) throws IOException {
    FileInputStream inputStream = new FileInputStream(file);
    byte[] buffer = new byte[(int) file.length()];
    int bytesRead = inputStream.read(buffer);
    inputStream.close();

    if (bytesRead <= 0) return "";
    return new String(buffer, 0, bytesRead);
  }

  public class OfflineDownloadsBridge {
    @JavascriptInterface
    public boolean hasConnection() {
      return isOnline();
    }

    @JavascriptInterface
    public String getManifest() {
      try {
        File manifest = new File(getFilesDir(), "offline-videos/manifest.json");

        if (!manifest.exists()) {
          return EMPTY_MANIFEST;
        }

        String content = readTextFile(manifest);
        return content == null || content.trim().isEmpty() ? EMPTY_MANIFEST : content;
      } catch (Exception error) {
        return EMPTY_MANIFEST;
      }
    }

    @JavascriptInterface
    public String getFileUrl(String storagePath) {
      try {
        if (storagePath == null || !storagePath.startsWith("offline-videos/") || storagePath.contains("..")) {
          return "";
        }

        File file = new File(getFilesDir(), storagePath);

        if (!file.exists()) {
          return "";
        }

        return Uri.fromFile(file).toString();
      } catch (Exception error) {
        return "";
      }
    }
  }
}
