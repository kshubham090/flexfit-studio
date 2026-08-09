import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">FlexFit Studio</h1>
        <p className="muted max-w-xl">
          Book classes, manage your membership, and track your attendance. Twelve classes
          a week across yoga, strength, spin and boxing.
        </p>
        <div className="flex gap-3 pt-2">
          <Link href="/schedule" className="btn btn-primary">
            View schedule
          </Link>
          <Link href="/plans" className="btn">
            Membership plans
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Studio A", "Yoga, vinyasa and mobility"],
          ["Studio B", "HIIT, boxing and circuits"],
          ["Spin Room", "20 bikes, two spin formats"],
        ].map(([room, blurb]) => (
          <div key={room} className="panel p-4">
            <h2 className="font-medium">{room}</h2>
            <p className="muted mt-1 text-sm">{blurb}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
