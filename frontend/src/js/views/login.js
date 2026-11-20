/* =============================================================
   Vista: Login con validación visual de campos obligatorios
   ============================================================= */
(function (A) {
  'use strict';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setState(input, msg) {
    const field = input.closest('.field');
    const err = document.getElementById(input.id + '-error');
    field.classList.toggle('invalid', !!msg);
    field.classList.toggle('valid', !msg && input.value.trim() !== '');
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    err.textContent = msg || '';
    return !msg;
  }

  function validateCorreo(input) {
    const v = input.value.trim();
    if (!v) return setState(input, 'El correo es obligatorio.');
    if (!EMAIL_RE.test(v)) return setState(input, 'Ingresa un correo válido (ej.: nombre@atelier.com).');
    return setState(input, '');
  }

  function validateContrasena(input) {
    const v = input.value;
    if (!v) return setState(input, 'La contraseña es obligatoria.');
    if (v.length < 6) return setState(input, 'La contraseña debe tener al menos 6 caracteres.');
    return setState(input, '');
  }

  A.login = {
    init(onSuccess) {
      const form = document.getElementById('login-form');
      const correo = document.getElementById('correo');
      const pass = document.getElementById('contrasena');
      const formErr = document.getElementById('login-error');

      // La etiqueta se mece un poco cuando algo no está bien
      function nudge() {
        form.classList.remove('nudge');
        void form.offsetWidth;            // reinicia la animación
        form.classList.add('nudge');
      }
      form.addEventListener('animationend', function () { form.classList.remove('nudge'); });

      // Mostrar / ocultar contraseña
      const toggle = document.getElementById('pass-toggle');
      function setVisible(show) {
        pass.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Ocultar' : 'Mostrar';
        toggle.setAttribute('aria-pressed', String(show));
      }
      toggle.addEventListener('click', function () { setVisible(pass.type === 'password'); pass.focus(); });

      // Valida al salir del campo y corrige en vivo una vez marcado como inválido
      correo.addEventListener('blur', function () { validateCorreo(correo); });
      pass.addEventListener('blur', function () { validateContrasena(pass); });
      correo.addEventListener('input', function () {
        formErr.textContent = '';
        if (correo.closest('.field').classList.contains('invalid')) validateCorreo(correo);
      });
      pass.addEventListener('input', function () {
        formErr.textContent = '';
        if (pass.closest('.field').classList.contains('invalid')) validateContrasena(pass);
      });

      function camposOk() {
        const ok = [validateCorreo(correo), validateContrasena(pass)].every(Boolean);
        if (!ok) {
          (form.querySelector('.invalid input') || correo).focus();
          nudge();
        }
        return ok;
      }
      // Un solo intento de entrada a la vez: mientras uno está en curso,
      // el botón de ingresar y los de la demo quedan bloqueados (también en la lógica).
      const btnLogin = form.querySelector('button[type=submit]');
      const btnsDemo = Array.prototype.slice.call(document.querySelectorAll('[data-demo-rol]'));
      let autenticando = false;
      function bloquear(si) {
        autenticando = si;
        btnLogin.disabled = si;
        btnsDemo.forEach(function (b) { b.disabled = si; });
        form.setAttribute('aria-busy', String(si));
      }

      // Espera a que el panel termine de abrir antes de soltar el bloqueo
      async function entrar(sesion) {
        form.reset();
        setVisible(false);
        formErr.textContent = '';
        form.querySelectorAll('.field').forEach(function (f) { f.classList.remove('valid', 'invalid'); });
        await onSuccess(sesion);
      }
      function fallo(err) {
        formErr.textContent = err.message || 'No se pudo iniciar sesión.';
        pass.value = '';
        pass.closest('.field').classList.remove('valid');
        pass.focus();
        nudge();
      }

      // Sesión real: POST /api/auth/login (PR #34). Si no hay servidor, no entra
      // en demo por su cuenta: lo dice y la persona decide.
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (autenticando || !camposOk()) return;
        bloquear(true);
        btnLogin.textContent = 'Ingresando…';
        try {
          await entrar(await A.api.login(correo.value.trim().toLowerCase(), pass.value));
        } catch (err) {
          if (!err.obsoleta) fallo(err);
        } finally {
          bloquear(false);
          btnLogin.textContent = 'Ingresar';
        }
      });

      // Demo explícita con usuarios ficticios: sin contraseña ni peticiones a la API.
      // Las credenciales reales nunca se muestran en esta pantalla.
      btnsDemo.forEach(function (b) {
        b.addEventListener('click', async function () {
          if (autenticando) return;
          bloquear(true);
          try {
            await entrar(A.api.loginDemo(b.dataset.demoRol));
          } catch (err) {
            fallo(err);
          } finally {
            bloquear(false);
          }
        });
      });
    },
  };
})(window.Atelier);
