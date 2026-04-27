package com.ugmovies247.app;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
  private static final String OFFLINE_PAGE_URL = "file:///android_asset/public/offline.html";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    Bridge currentBridge = this.bridge;
    WebView webView = currentBridge.getWebView();

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

    if (connectivityManager == null) {
      return false;
    }

    Network network = connectivityManager.getActiveNetwork();
    if (network == null) {
      return false;
    }

    NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
    return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
  }
}
