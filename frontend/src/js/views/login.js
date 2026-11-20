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

      // Cuentas de prueba del talón: llenan el formulario
      form.querySelectorAll('[data-demo]').forEach(function (b) {
        b.addEventListener('click', function () {
          correo.value = b.dataset.demo;
          pass.value = '123456';
          formErr.textContent = '';
          validateCorreo(correo); validateContrasena(pass);
          form.querySelector('button[type=submit]').focus();
        });
      });

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

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const ok = [validateCorreo(correo), validateContrasena(pass)].every(Boolean);
        if (!ok) {
          (form.querySelector('.invalid input') || correo).focus();
          nudge();
          return;
        }
        // Autenticación provisional contra los usuarios del seed.
        // La autenticación real (POST /api/auth/login, RF-01) llega en Fase 4.
        const user = A.mock.usuarios.find(function (u) {
          return u.correo === correo.value.trim().toLowerCase();
        });
        if (!user || pass.value !== '123456') {
          formErr.textContent = 'Correo o contraseña incorrectos.';
          pass.value = '';
          pass.closest('.field').classList.remove('valid');
          pass.focus();
          nudge();
          return;
        }
        form.reset();
        setVisible(false);
        form.querySelectorAll('.field').forEach(function (f) { f.classList.remove('valid', 'invalid'); });
        onSuccess(user);
      });
    },
  };
})(window.Atelier);
