using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations;

[DbContext(typeof(GameDbContext))]
[Migration("20261104110200_AddActiveScene")]
public partial class AddActiveScene : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "ActiveSceneId",
            table: "Games",
            type: "TEXT",
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "ActiveSceneId",
            table: "Games");
    }
}
