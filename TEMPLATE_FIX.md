# Fix Template Rendering Issues

## Vấn đề:
- `{{/if}}` hiển thị trong UI
- Template conditionals không được replace đúng
- Google OAuth không cần thiết

## Nguyên nhân:
Logic replace template sử dụng regex phức tạp và dễ lỗi. Cần refactor.

## Giải pháp:

### 1. Đơn giản hóa template rendering
Thay vì dùng nhiều regex replace, dùng một template engine đơn giản:

```typescript
function renderTemplate(template: string, data: Record<string, any>): string {
  let result = template;
  
  // Replace simple variables {{varName}}
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, String(value));
  }
  
  // Handle conditionals {{#if condition}}...{{else}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (match, condition, truthy, falsy) => {
      return data[condition] ? truthy : (falsy || '');
    }
  );
  
  return result;
}
```

### 2. Sử dụng template engine:

```typescript
// In admin dashboard route
app.get('/', async (req: Request, res: Response) => {
  // ... authentication logic ...
  
  const templateData = {
    userEmail,
    apiToken,
    hasEmbeddingKey: !!process.env.EMBEDDINGS_API_KEYS,
    hasRerankKey: !!process.env.RERANK_API_KEYS,
    googleConfigured: false, // Disable Google OAuth
    success: req.query.success === 'true',
    error: req.query.error === '1',
    embeddingsApiKeys: maskApiKeys(process.env.EMBEDDINGS_API_KEYS || ''),
    rerankApiKeys: maskApiKeys(process.env.RERANK_API_KEYS || ''),
    // ... other data
  };
  
  const html = renderTemplate(ADMIN_HTML_TEMPLATE, templateData);
  res.send(html);
});
```

### 3. Loại bỏ Google OAuth hoàn toàn:

```typescript
// Remove these imports:
- import passport from 'passport';
- import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

// Remove passport setup
- app.use(passport.initialize());
- app.use(passport.session());

// Remove Google routes
- app.get('/auth/google', ...)
- app.get('/auth/google/callback', ...)

// In LOGIN_HTML_TEMPLATE, remove:
{{#if googleConfigured}}
  <a href="/auth/google" class="btn-google">...</a>
  <div class="divider">HOẶC DÙNG MẬT KHẨU</div>
{{/if}}
```

### 4. Cập nhật ADMIN_HTML_TEMPLATE:

Loại bỏ phần Google OAuth Settings:

```html
<!-- REMOVE THIS SECTION -->
<div class="card-subtitle">Google OAuth Settings</div>
<div class="form-group">
  <label for="input-google-client-id">Google Client ID</label>
  <input type="text" id="input-google-client-id" name="google_client_id" value="{{googleClientId}}" />
</div>
<div class="form-group">
  <label for="input-google-client-secret">Google Client Secret</label>
  <input type="password" id="input-google-client-secret" name="google_client_secret" value="{{googleClientSecret}}" />
</div>
```

## Quick Fix (Tạm thời):

Nếu chưa muốn refactor lớn, fix nhanh bằng cách đảm bảo tất cả conditionals được replace:

```typescript
// Add this helper function
function cleanTemplate(html: string): string {
  // Remove any unprocessed template tags
  return html
    .replace(/\{\{#if\s+\w+\}\}/g, '')
    .replace(/\{\{else\}\}/g, '')
    .replace(/\{\{\/if\}\}/g, '')
    .replace(/\{\{\w+\}\}/g, ''); // Remove unreplaced variables
}

// Before sending response
const html = renderAdminPage(templateData);
const cleanHtml = cleanTemplate(html);
res.send(cleanHtml);
```

## Recommended Approach:

1. **Immediate**: Use `cleanTemplate()` để remove tất cả template tags chưa được process
2. **Short-term**: Disable Google OAuth bằng cách set `googleConfigured: false` 
3. **Long-term**: Refactor sang template engine đơn giản hơn (mustache, handlebars)

## Test:

```bash
# 1. Rebuild
npm run build

# 2. Start server  
node dist/index.js mcp-http --port 3000

# 3. Check UI
# Should NOT see {{/if}} or any template tags
# Should see both Embeddings and Rerank badges
# Should NOT see Google OAuth section
```

---

Bạn muốn tôi implement quick fix ngay bây giờ không?
