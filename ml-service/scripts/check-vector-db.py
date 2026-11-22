"""Check the local synthetic database using the restricted login."""

from vector_db_credentials import read_vector_password

import psycopg


def main() -> None:
    password = read_vector_password()

    try:
        with psycopg.connect(
            host="127.0.0.1",
            port=5544,
            dbname="gigzlk_vector_dev",
            user="gigzlk_vector_client",
            password=password,
            connect_timeout=5,
            options="-c statement_timeout=5000",
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        current_user,
                        current_database(),
                        has_schema_privilege(current_user, 'ml', 'CREATE')
                    """
                )
                identity = cursor.fetchone()

                if identity != (
                    "gigzlk_vector_client",
                    "gigzlk_vector_dev",
                    False,
                ):
                    raise RuntimeError("Unexpected database permissions.")

                cursor.execute(
                    """
                    SELECT entity_kind, visibility, count(*)
                    FROM ml.synthetic_entities
                    GROUP BY entity_kind, visibility
                    ORDER BY entity_kind, visibility
                    """
                )
                counts = cursor.fetchall()

        print("Restricted Python database connection passed.")
        for kind, visibility, count in counts:
            print(f"{kind}: {visibility} = {count}")

    except psycopg.Error:
        raise SystemExit(
            "Database check failed. Check the container, port and password."
        ) from None


if __name__ == "__main__":
    main()