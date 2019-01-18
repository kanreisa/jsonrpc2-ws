export default class MapLike<V> {

    private readonly _map: {[key: string]: V} = {};

    get size(): number {
        return this.keys().length;
    }

    clear(): void {
        for (const key in this._map) {
            delete this._map[key];
        }
    }

    delete(key: string): boolean {
        if (this.has(key)) {
            return delete this._map[key];
        }
        return false;
    }

    get(key: string): V | undefined {
        return this._map[key];
    }

    has(key: string): boolean {
        return this._map[key] !== undefined;
    }

    keys(): string[] {
        return Object.keys(this._map);
    }

    set(key: string, value: V): this {
        this._map[key] = value;
        return this;
    }

    values(): V[] {
        const values: V[] = [];
        for (const key in this._map) {
            values.push(this._map[key]);
        }
        return values;
    }
}
