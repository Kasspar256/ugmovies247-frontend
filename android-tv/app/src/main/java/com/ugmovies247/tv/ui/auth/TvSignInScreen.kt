package com.ugmovies247.tv.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text

@Composable
fun TvSignInScreen(
    isLoading: Boolean,
    error: String?,
    onSignIn: (String, String) -> Unit,
    onBack: () -> Unit
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val emailFocusRequester = remember { FocusRequester() }

    BackHandler(onBack = onBack)

    LaunchedEffect(Unit) {
        emailFocusRequester.requestFocus()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 72.dp, vertical = 56.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(22.dp)) {
            Text(
                text = "Sign in to UG Movies 247 TV",
                color = Color.White,
                style = MaterialTheme.typography.displayLarge
            )

            Text(
                text = "Use your existing UG Movies 247 account to unlock premium movies.",
                color = Color(0xFFD5DAE3),
                style = MaterialTheme.typography.bodyLarge
            )

            TvTextInput(
                value = email,
                onValueChange = { email = it },
                label = "Email",
                focusRequester = emailFocusRequester,
                keyboardType = KeyboardType.Email
            )

            TvTextInput(
                value = password,
                onValueChange = { password = it },
                label = "Password",
                isPassword = true
            )

            if (!error.isNullOrBlank()) {
                Text(
                    text = error,
                    color = Color(0xFFFF6B7D),
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                TvAuthButton(
                    label = if (isLoading) "Signing In..." else "Sign In",
                    enabled = !isLoading && email.isNotBlank() && password.isNotBlank(),
                    onClick = { onSignIn(email, password) }
                )

                TvAuthButton(
                    label = "Back",
                    enabled = !isLoading,
                    onClick = onBack
                )
            }
        }
    }
}

@Composable
private fun TvTextInput(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    focusRequester: FocusRequester? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    isPassword: Boolean = false
) {
    var focused by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = label.uppercase(),
            color = if (focused) Color.White else Color(0xFFB8C0CC),
            style = MaterialTheme.typography.labelLarge
        )

        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                color = Color.White,
                fontSize = MaterialTheme.typography.titleLarge.fontSize,
                fontWeight = MaterialTheme.typography.titleLarge.fontWeight
            ),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            visualTransformation = if (isPassword) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            cursorBrush = SolidColor(Color(0xFFE5092F)),
            modifier = modifier
                .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                .onFocusChanged { focused = it.isFocused || it.hasFocus }
                .focusable()
                .background(Color(0xFF171B25), RoundedCornerShape(16.dp))
                .border(
                    BorderStroke(
                        width = if (focused) 3.dp else 1.dp,
                        color = if (focused) Color(0xFFFF3157) else Color.White.copy(alpha = 0.18f)
                    ),
                    RoundedCornerShape(16.dp)
                )
                .padding(horizontal = 18.dp, vertical = 14.dp)
        )
    }
}

@Composable
private fun TvAuthButton(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val interactionSource = remember { MutableInteractionSource() }

    Box(
        modifier = Modifier
            .background(
                when {
                    !enabled -> Color(0xFF2A2E38)
                    focused -> Color(0xFFE5092F)
                    else -> Color(0xFF171B25)
                },
                RoundedCornerShape(999.dp)
            )
            .border(
                BorderStroke(2.dp, if (focused) Color.White else Color.White.copy(alpha = 0.18f)),
                RoundedCornerShape(999.dp)
            )
            .onFocusChanged { focused = it.isFocused || it.hasFocus }
            .focusable(interactionSource = interactionSource)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Button,
                enabled = enabled,
                onClick = onClick
            )
            .padding(horizontal = 28.dp, vertical = 14.dp)
    ) {
        Text(
            text = label.uppercase(),
            color = Color.White,
            style = MaterialTheme.typography.labelLarge
        )
    }
}
