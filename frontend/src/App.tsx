import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { authApi, shopApi, type AppUser, type CartItem, type ShopOrder, type ShopProduct } from "./services/auth-api";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
let googleScriptPromise: Promise<void> | undefined;
let googleInitialized = false;
let credentialHandler: ((credential: string) => void) | undefined;
const cartStorageKey = "shop-cart";
function readCart(): CartItem[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(cartStorageKey) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is CartItem => typeof item === "object" && item !== null && typeof item.product_id === "string" && /^[1-9]\d*$/.test(item.product_id) && Number.isSafeInteger(item.quantity) && item.quantity > 0) : []; } catch { return []; }
}
function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (!googleScriptPromise) googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]'); const script = existing ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true; script.onload = () => resolve(); script.onerror = () => reject(new Error("Google sign-in could not be loaded.")); if (!existing) document.head.appendChild(script);
  });
  return googleScriptPromise;
}

export default function App() {
  const button = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<AppUser | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]); const [cart, setCart] = useState<CartItem[]>(readCart); const [checkoutBusy, setCheckoutBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  useEffect(() => { localStorage.setItem(cartStorageKey, JSON.stringify(cart)); }, [cart]);
  const refreshProducts = () => shopApi.products().then(setProducts).catch(() => setError("Could not load products. Try again shortly."));
  useEffect(() => { void refreshProducts(); }, []);
  async function signInWithCredential(credential: string) {
    setError(null); setLoading(true); try { setUser(await authApi.signIn(credential)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in failed."); } finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true; credentialHandler = (credential) => { void signInWithCredential(credential); };
    void authApi.currentUser().then((current) => { if (active) setUser(current); }).catch(() => { if (active) setError("Could not connect to the shop. Try again shortly."); }).finally(() => { if (active) setLoading(false); });
    if (googleClientId && button.current) void loadGoogleIdentity().then(() => {
      if (!active || !button.current || !window.google) return;
      if (!googleInitialized) { window.google.accounts.id.initialize({ client_id: googleClientId, callback: (response) => { if (response.credential) credentialHandler?.(response.credential); } }); googleInitialized = true; }
      window.google.accounts.id.renderButton(button.current, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 280 });
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Google sign-in could not be loaded."); });
    return () => { active = false; credentialHandler = undefined; };
  }, []);
  async function logout() { setError(null); setLoading(true); try { await authApi.logout(); setUser(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-out failed."); } finally { setLoading(false); } }
  function setQuantity(productId: string, quantity: number) { setCart((current) => quantity <= 0 ? current.filter((item) => item.product_id !== productId) : current.map((item) => item.product_id === productId ? { ...item, quantity } : item)); }
  async function checkout() { if (!user || cart.length === 0 || checkoutBusy) return; setCheckoutBusy(true); setError(null); setNotice(null); try { const order = await shopApi.checkout(cart); setCart([]); setNotice(`Order #${order.id} placed. Total: $${order.total_amount}.`); await refreshProducts(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkout failed. Please try again."); void refreshProducts(); } finally { setCheckoutBusy(false); } }

  return <main className="shell">
    <header className="site-header"><Link to="/" className="brand">Shop App</Link><nav aria-label="Main navigation"><Link to="/">Shop</Link><Link to="/cart">Cart ({itemCount})</Link>{user && <Link to="/orders">My orders</Link>}{user?.role === "shop_owner" && <Link to="/manage">Manage products</Link>}</nav>
      {user ? <div className="header-user"><span>{user.name}</span><button type="button" onClick={() => void logout()}>Sign out</button></div> : <div className="signin" ref={button}>{!loading && !googleClientId && <span>Set VITE_GOOGLE_CLIENT_ID to enable sign-in.</span>}</div>}
    </header>
    {loading && <p role="status">Loading your account…</p>}{error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <Routes>
      <Route path="/" element={<><h1>Available products</h1><ProductGrid products={products} addToCart={(p) => setCart((current) => { const found = current.find((item) => item.product_id === p.id); return found ? current.map((item) => item.product_id === p.id ? { ...item, quantity: Math.min(p.stock_quantity, item.quantity + 1) } : item) : [...current, { product_id: p.id, quantity: 1 }]; })} /></>} />
      <Route path="/products/:id" element={<ProductDetails products={products} add={(product) => setCart((current) => { const found = current.find((item) => item.product_id === product.id); return found ? current.map((item) => item.product_id === product.id ? { ...item, quantity: Math.min(product.stock_quantity, item.quantity + 1) } : item) : [...current, { product_id: product.id, quantity: 1 }]; })} />} />
      <Route path="/cart" element={<CartPage cart={cart} products={products} setQuantity={setQuantity} checkout={checkout} busy={checkoutBusy} signedIn={Boolean(user)} />} />
      <Route path="/orders" element={user ? <OrderHistory /> : <SignInPrompt />} />
      <Route path="/manage" element={user?.role === "shop_owner" ? <ManageProducts products={products} refresh={refreshProducts} /> : <SignInPrompt />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </main>;
}

function ProductGrid({ products, addToCart }: { products: ShopProduct[]; addToCart: (product: ShopProduct) => void }) {
  if (!products.length) return <p>No products are available yet.</p>;
  return <div className="product-grid">{products.map((product) => <article className="product-card" key={product.id}>{product.image_url && <Link to={`/products/${product.id}`}><img src={product.image_url} alt={product.name} /></Link>}<h2><Link to={`/products/${product.id}`}>{product.name}</Link></h2><p>{product.description}</p><p><strong>${Number(product.price).toFixed(2)}</strong> · {product.stock_quantity} in stock</p><button type="button" disabled={product.stock_quantity < 1} onClick={() => addToCart(product)}>Add to cart</button></article>)}</div>;
}
function ProductDetails({ products, add }: { products: ShopProduct[]; add: (product: ShopProduct) => void }) {
  const { id = "" } = useParams(); const [product, setProduct] = useState<ShopProduct | null>(products.find((item) => item.id === id) ?? null); const [failed, setFailed] = useState(false);
  useEffect(() => { setProduct(products.find((item) => item.id === id) ?? null); void shopApi.product(id).then(setProduct).catch(() => setFailed(true)); }, [id, products]);
  if (failed && !product) return <p>Product not found.</p>; if (!product) return <p>Loading product…</p>;
  return <section className="detail-page"><Link to="/">← Back to shop</Link>{product.image_url && <img src={product.image_url} alt={product.name} />}<div><p className="eyebrow">Product details</p><h1>{product.name}</h1><p>{product.description}</p><p className="detail-price">${Number(product.price).toFixed(2)}</p><p>{product.stock_quantity} in stock</p><button type="button" disabled={product.stock_quantity < 1} onClick={() => add(product)}>Add to cart</button></div></section>;
}
function CartPage({ cart, products, setQuantity, checkout, busy, signedIn }: { cart: CartItem[]; products: ShopProduct[]; setQuantity: (id: string, quantity: number) => void; checkout: () => void; busy: boolean; signedIn: boolean }) {
  const rows = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.product_id) })).filter((item): item is typeof item & { product: ShopProduct } => Boolean(item.product));
  return <section className="page-section"><p className="eyebrow">Your selection</p><h1>Shopping cart</h1>{!rows.length ? <p>Your cart is empty. <Link to="/">Browse products</Link></p> : <><ul className="cart-list">{rows.map(({ product, quantity }) => <li key={product.id}><Link to={`/products/${product.id}`}><strong>{product.name}</strong></Link><span>${Number(product.price).toFixed(2)} each</span><label>Qty <input aria-label={`Quantity for ${product.name}`} type="number" min="1" max={product.stock_quantity + quantity} value={quantity} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) setQuantity(product.id, Math.min(product.stock_quantity + quantity, Math.floor(n))); }} /></label><button className="remove-button" onClick={() => setQuantity(product.id, 0)}>Remove</button></li>)}</ul><p className="cart-total">Estimated total <strong>${rows.reduce((sum, row) => sum + Number(row.product.price) * row.quantity, 0).toFixed(2)}</strong></p><button disabled={!signedIn || busy || rows.length !== cart.length} onClick={checkout}>{busy ? "Placing order…" : signedIn ? "Checkout" : "Sign in to checkout"}</button>{!signedIn && <p>Sign in with Google above to place your order.</p>}<p className="cart-caption">Final prices and availability are confirmed at checkout.</p></>}</section>;
}
function SignInPrompt() { return <section className="page-section"><h1>Sign in required</h1><p>Sign in with Google to view your account features.</p></section>; }
function OrderHistory() {
  const [orders, setOrders] = useState<ShopOrder[] | null>(null); const [error, setError] = useState("");
  useEffect(() => { void shopApi.orders().then(setOrders).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load orders.")); }, []);
  return <section className="page-section"><p className="eyebrow">Your account</p><h1>Order history</h1>{error && <p className="error">{error}</p>}{orders === null ? <p>Loading orders…</p> : orders.length === 0 ? <p>You have not placed any orders yet. <Link to="/">Browse products</Link></p> : <div className="order-list">{orders.map((order) => <article className="order-card" key={order.id}><div className="order-heading"><h2>Order #{order.id}</h2><span>{order.status}</span></div><p>{new Date(order.created_at).toLocaleString()}</p><ul>{order.items.map((item, i) => <li key={`${item.product_id}-${i}`}>{item.name} × {item.quantity} <strong>${(Number(item.unit_price) * item.quantity).toFixed(2)}</strong></li>)}</ul><p className="cart-total">Total <strong>${order.total_amount}</strong></p></article>)}</div>}</section>;
}
function ManageProducts({ products, refresh }: { products: ShopProduct[]; refresh: () => Promise<void> }) {
  const empty = { name: "", description: "", price: "", image_url: "", stock_quantity: "" };
  const [editing, setEditing] = useState<string | null>(null); const [form, setForm] = useState(empty); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const navigate = useNavigate();
  function edit(product: ShopProduct) { setEditing(product.id); setForm({ name: product.name, description: product.description, price: product.price, image_url: product.image_url ?? "", stock_quantity: String(product.stock_quantity) }); }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const data = { name: form.name, description: form.description, price: Number(form.price), image_url: form.image_url || null, stock_quantity: Number(form.stock_quantity) }; try { if (editing) await shopApi.updateProduct(editing, data); else await shopApi.createProduct(data); setEditing(null); setForm(empty); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save product."); } finally { setBusy(false); } }
  async function remove(id: string) { if (!window.confirm("Delete this product?")) return; try { await shopApi.deleteProduct(id); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete product."); } }
  return <section className="page-section"><p className="eyebrow">Shop owner</p><h1>Manage products</h1><form className="product-form" onSubmit={(e) => void save(e)}><h2>{editing ? "Edit product" : "Add a product"}</h2>{error && <p className="error">{error}</p>}<label>Name<input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Description<textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><div className="form-row"><label>Price ($)<input required type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label><label>Stock quantity<input required type="number" min="0" step="1" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></label></div><label>Image URL<input type="url" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></label><div className="form-actions"><button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add product"}</button>{editing && <button type="button" className="secondary-button" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}</div></form><h2>Current products</h2>{!products.length && <p>No products yet.</p>}<div className="manage-list">{products.map((product) => <article key={product.id}><div><strong>{product.name}</strong><span>${Number(product.price).toFixed(2)} · {product.stock_quantity} in stock</span></div><button className="secondary-button" onClick={() => edit(product)}>Edit</button><button className="remove-button" onClick={() => void remove(product.id)}>Delete</button></article>)}</div><button className="secondary-button" onClick={() => navigate("/")}>View shop</button></section>;
}
