import { Button } from '../../design/button.js';

/** The component gallery. Built out properly in phase 7's styleguide commit. */
export function Styleguide() {
  return (
    <div className="container py-16">
      <h1 className="display display-section">Styleguide</h1>
      <div className="mt-8 flex gap-4">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
      </div>
    </div>
  );
}
